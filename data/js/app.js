/**
 * AquaGuard SCADA — Stitch Telemetry & Control Engine
 * WebSocket client, reactive UI updater, and tactile actuator controller
 */
'use strict';

const app = {
  ws: null,
  wsUrl: '',
  reconnectAttempts: 0,
  maxReconnectDelay: 4000,
  reconnectTimer: null,
  state: null,
  lastDataTime: 0,
  isOffline: false,
  activeTab: 'overview',

  apiBase: '',

  init() {
    console.log('[AquaGuard SCADA] Initializing Stitch telemetry bridge...');
    const isFile = window.location.protocol === 'file:';
    const host = (!isFile && window.location.host) ? window.location.host : '192.168.4.1';
    this.apiBase = isFile ? 'http://192.168.4.1' : '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = `${protocol}//${host}/ws`;

    // Initialize sound engine
    sound.init();
    // Unlock AudioContext on first touch / interaction (Mobile browser compliance)
    const unlockAudio = () => {
      sound.unlock();
    };
    ['pointerdown', 'touchstart', 'touchend', 'click'].forEach(evt => {
      window.addEventListener(evt, unlockAudio, { passive: true });
    });

    // Immediately fetch state so UI populates in <50ms without waiting for WebSocket
    this.fetchState();
    this.connectWs();
    this.startWatchdog();

    // Check liveness
    setInterval(() => this.checkLiveness(), 1000);
  },

  fetchState() {
    fetch(this.apiBase + '/api/state')
      .then(res => res.json())
      .then(d => this.handleStateUpdate(d))
      .catch(err => console.warn('[AquaGuard] State fetch:', err));
  },

  formatAlarms(alarms) {
    if (!alarms) return 'NORMAL OPERATION • LEVEL OPTIMAL';
    if (Array.isArray(alarms)) return alarms.join(' • ');
    if (typeof alarms === 'number') {
      const list = [];
      if (alarms & 0x0001) list.push('FLAME DETECTED');
      if (alarms & 0x0002) list.push('GAS WARNING');
      if (alarms & 0x0004) list.push('GAS DANGER');
      if (alarms & 0x0008) list.push('PROXIMITY DANGER');
      if (alarms & 0x0010) list.push('SPILLWAY CRITICAL');
      if (alarms & 0x0020) list.push('PROBE FAULT');
      if (alarms & 0x0040) list.push('RESERVOIR HIGH');
      if (alarms & 0x0080) list.push('PROXIMITY WARNING');
      if (alarms & 0x0100) list.push('FLOW TIMEOUT');
      if (alarms & 0x0200) list.push('GATE JAMMED');
      if (alarms & 0x0400) list.push('SENSOR DISCONNECTED');
      if (alarms & 0x0800) list.push('PROX AUTO WARNING');
      return list.length > 0 ? list.join(' • ') : 'CRITICAL HAZARD DETECTED';
    }
    return String(alarms);
  },

  connectWs() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const badge = document.getElementById('top-status-badge');
    const dot = document.getElementById('top-status-dot');
    const text = document.getElementById('top-status-text');
    if (text) text.textContent = 'CONNECTING';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-ping shadow-[0_0_8px_#f59e0b]';

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log('[AquaGuard SCADA] WebSocket linked');
        this.reconnectAttempts = 0;
        this.setOffline(false);
      };

      this.ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          this.handleStateUpdate(data);
        } catch (e) {
          console.warn('[AquaGuard SCADA] JSON parse error:', e);
        }
      };

      this.ws.onclose = () => {
        console.log('[AquaGuard SCADA] WebSocket connection closed');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.scheduleReconnect();
      };
    } catch (e) {
      this.scheduleReconnect();
    }
  },

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.setOffline(true);
    const delay = Math.min(1000 * Math.pow(1.4, this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWs();
    }, delay);
  },

  checkLiveness() {
    const now = Date.now();
    if (this.lastDataTime > 0 && (now - this.lastDataTime) > 4000) {
      this.setOffline(true);
    }
  },

  setOffline(offline) {
    this.isOffline = offline;
    const dot = document.getElementById('top-status-dot');
    const text = document.getElementById('top-status-text');
    const connDot = document.getElementById('conn-dot');
    const badge = document.getElementById('top-status-badge');

    if (offline) {
      if (text) text.textContent = 'OFFLINE';
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]';
      if (connDot) connDot.className = 'w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]';
      if (badge) badge.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-red-950/20 border border-red-500/40 text-red-400';
    } else {
      if (text) text.textContent = 'ONLINE';
      if (dot) dot.className = 'w-2 h-2 rounded-full bg-secondary animate-pulse shadow-[0_0_8px_#4edea3]';
      if (connDot) connDot.className = 'w-1.5 h-1.5 rounded-full bg-secondary shadow-[0_0_8px_#4edea3]';
      if (badge) badge.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-secondary-container/10 border border-secondary/30 text-secondary';
    }
  },

  handleStateUpdate(data) {
    try {
      this.lastDataTime = Date.now();
      this.setOffline(false);

    // Protect optimistic controls from being immediately reverted by in-flight/stale telemetry
    const now = Date.now();
    if (this.state) {
      if (this._modeLockUntil && now < this._modeLockUntil && this.state.mode) {
        data.mode = this.state.mode;
      }
      if (this._gateLockUntil && now < this._gateLockUntil && this.state.gate) {
        if (!data.gate) data.gate = {};
        data.gate.target = this.state.gate.target;
      }
      if (this._turbineLockUntil && now < this._turbineLockUntil && this.state.turbine) {
        if (!data.turbine) data.turbine = {};
        data.turbine.on = this.state.turbine.on;
        data.turbine.speed = this.state.turbine.speed;
      }
      if (this._pumpLockUntil && now < this._pumpLockUntil && this.state.pumps && data.pumps) {
        if (this.state.pumps[0]) {
          data.pumps[0].on = this.state.pumps[0].on;
          data.pumps[0].speed = this.state.pumps[0].speed;
        }
        if (this.state.pumps[1]) {
          data.pumps[1].on = this.state.pumps[1].on;
          data.pumps[1].speed = this.state.pumps[1].speed;
        }
      }
    }
    this.state = data;

    // 1. Top bar & Overview state banner
    const status = (data.status || 'SAFE').toUpperCase();
    const banner = document.getElementById('home-state-banner');
    const bannerTitle = document.getElementById('state-banner-title');
    const bannerCode = document.getElementById('state-banner-code');
    const bannerSub = document.getElementById('state-banner-sub');
    const bannerIcon = document.getElementById('state-banner-icon');
    const bannerIconWrap = document.getElementById('state-banner-icon-wrap');
    const ackBtn = document.getElementById('banner-ack-btn');
    const modeBadge = document.getElementById('mode-badge-label');

    if (modeBadge) {
      modeBadge.textContent = `${(data.mode || 'manual').toUpperCase()} MODE • R-ZONE 04`;
    }

    if (banner && bannerTitle) {
      if (status === 'CRITICAL') {
        banner.className = 'rounded-2xl p-3 bg-red-500/15 border border-red-500/60 flex items-center justify-between shadow-[0_0_24px_rgba(239,68,68,0.4)] animate-pulse';
        bannerTitle.textContent = 'CRITICAL';
        bannerTitle.className = 'font-headline-lg font-bold text-error tracking-tight text-xl';
        if (bannerCode) {
          bannerCode.textContent = 'ALARM TRIP';
          bannerCode.className = 'px-1.5 py-0.5 rounded bg-error/20 font-label-sm text-[10px] text-error font-bold';
        }
        if (bannerSub) bannerSub.textContent = this.formatAlarms(data.alarms);
        if (bannerIcon) bannerIcon.innerHTML = '<svg class="w-6 h-6 animate-pulse" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
        if (bannerIconWrap) bannerIconWrap.className = 'w-10 h-10 rounded-xl bg-error-container/40 border border-error flex items-center justify-center text-error';
        if (ackBtn) ackBtn.classList.remove('hidden');
        sound.playCriticalAlarm();
      } else if (status === 'WARNING') {
        banner.className = 'rounded-2xl p-3 bg-amber-500/15 border border-amber-500/50 flex items-center justify-between shadow-[0_0_20px_rgba(245,158,11,0.3)]';
        bannerTitle.textContent = 'WARNING';
        bannerTitle.className = 'font-headline-lg font-bold text-amber-400 tracking-tight text-xl';
        if (bannerCode) {
          bannerCode.textContent = 'CAUTION';
          bannerCode.className = 'px-1.5 py-0.5 rounded bg-amber-500/20 font-label-sm text-[10px] text-amber-400 font-bold';
        }
        if (bannerSub) bannerSub.textContent = this.formatAlarms(data.alarms);
        if (bannerIcon) bannerIcon.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>';
        if (bannerIconWrap) bannerIconWrap.className = 'w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500 flex items-center justify-center text-amber-400';
        if (ackBtn) ackBtn.classList.add('hidden');
        sound.playWarningAlert();
      } else {
        banner.className = 'rounded-2xl p-3 bg-secondary/10 border border-secondary/40 flex items-center justify-between shadow-[0_0_15px_rgba(16,185,129,0.25)]';
        bannerTitle.textContent = 'SAFE';
        bannerTitle.className = 'font-headline-lg font-bold text-secondary tracking-tight text-xl';
        if (bannerCode) {
          bannerCode.textContent = 'STATE A';
          bannerCode.className = 'px-1.5 py-0.5 rounded bg-secondary/20 font-label-sm text-[10px] text-secondary font-bold';
        }
        if (bannerSub) bannerSub.textContent = 'NORMAL OPERATION • LEVEL OPTIMAL';
        if (bannerIcon) bannerIcon.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>';
        if (bannerIconWrap) bannerIconWrap.className = 'w-10 h-10 rounded-xl bg-secondary-container/30 border border-secondary flex items-center justify-center text-secondary';
        if (ackBtn) ackBtn.classList.add('hidden');
      }
    }

    // 2. Water Tank Telemetry
    const levelPct = data.level ? (data.level.percent || 0) : 0;
    const waterDist = data.level ? (data.level.distanceCm || 0) : 0;
    const depthCm = data.level ? (data.level.depthCm || 0) : 0;
    const depthIn = data.level ? (data.level.depthIn || 0) : 0;
    const waterBox = document.getElementById('water-fill-box');
    const waterPctEl = document.getElementById('water-pct-display');
    const waterCapEl = document.getElementById('water-capacity-metric');
    const waterElevEl = document.getElementById('water-elevation-label');
    const waterDistEl = document.getElementById('water-dist-metric');

    if (waterBox) waterBox.style.height = `${Math.max(8, Math.min(100, levelPct))}%`;
    if (waterPctEl) waterPctEl.textContent = `${levelPct}%`;
    if (waterCapEl) waterCapEl.textContent = `${(levelPct * 25).toLocaleString()}`;
    if (waterDistEl) {
      if (waterDist > 0) {
        waterDistEl.textContent = `${waterDist.toFixed(1)} cm gap • ${depthIn.toFixed(1)}" depth`;
      } else {
        waterDistEl.textContent = 'HC-SR04 SONAR';
      }
    }
    if (waterElevEl) {
      if (levelPct >= 95) waterElevEl.textContent = 'CRITICAL FLOOD SPILLWAY BREACH';
      else if (levelPct >= 75) waterElevEl.textContent = 'HIGH RETENTION POOL';
      else if (levelPct >= 50) waterElevEl.textContent = 'MED CONSERVANCY ELEVATION';
      else waterElevEl.textContent = 'LOW POOL ELEVATION';
    }

    // 3. Spillway Gate (SVG + Horn)
    const gateAngle = data.gate ? (data.gate.actual !== undefined ? data.gate.actual : data.gate.target) : 0;
    const gatePill = document.getElementById('gate-angle-pill');
    const svgArm = document.getElementById('svg-gate-arm');
    const svgAngleText = document.getElementById('svg-angle-text');
    const svgDischarge = document.getElementById('svg-discharge-stream');
    const svgChevrons = document.getElementById('svg-flow-chevrons');
    const gateFlowRate = document.getElementById('gate-flow-rate-text');
    const tailraceState = document.getElementById('tailrace-flow-state');

    if (gatePill) gatePill.textContent = `${gateAngle}° ${gateAngle === 0 ? 'CLOSED' : 'OPEN'}`;
    if (svgArm) {
      // Rotate gate arm: 0 deg = 0 rot, 100 deg = -45 deg rotation
      const rot = (gateAngle / 100) * -45;
      svgArm.setAttribute('transform', `rotate(${rot} 160 30)`);
    }
    if (svgAngleText) svgAngleText.textContent = `θ = ${gateAngle}°`;

    const flowState = data.flow ? data.flow.state : 'CLOSED';
    const isFlowConfirmed = flowState === 'FLOW_CONFIRMED';
    if (svgDischarge) svgDischarge.setAttribute('opacity', isFlowConfirmed ? '0.85' : (gateAngle > 10 ? '0.3' : '0'));
    if (svgChevrons) svgChevrons.setAttribute('opacity', isFlowConfirmed ? '1' : '0');
    if (gateFlowRate) gateFlowRate.textContent = isFlowConfirmed ? `${(gateAngle * 1.4).toFixed(1)} mL/s` : '0.0 mL/s';
    if (tailraceState) {
      tailraceState.textContent = isFlowConfirmed ? 'WET (FLOW CONFIRMED)' : 'DRY';
      tailraceState.className = isFlowConfirmed ? 'font-label-sm text-[10px] text-primary-container font-mono font-bold' : 'font-label-sm text-[10px] text-outline font-mono';
    }

    // 4. Quick Status Row
    if (data.pumps && data.pumps.length >= 2) {
      const p1 = data.pumps[0];
      const p2 = data.pumps[1];
      const p1Text = document.getElementById('text-pump1');
      const p1Dot = document.getElementById('dot-pump1');
      const p1Pill = document.getElementById('pill-pump1');
      const p2Text = document.getElementById('text-pump2');
      const p2Dot = document.getElementById('dot-pump2');
      const p2Pill = document.getElementById('pill-pump2');

      if (p1Text) p1Text.textContent = `PUMP 1: ${p1.on ? p1.speed + '%' : 'OFF'}`;
      if (p1Dot) p1Dot.className = p1.on ? 'w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_#4edea3] animate-pulse' : 'w-2 h-2 rounded-full bg-outline';
      if (p1Pill) p1Pill.className = p1.on ? 'flex-1 bg-secondary/15 border border-secondary/40 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 shadow-[0_0_12px_rgba(78,222,163,0.15)]' : 'flex-1 bg-surface-container-high/40 border border-outline-variant/30 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 opacity-70';

      if (p2Text) p2Text.textContent = `PUMP 2: ${p2.on ? p2.speed + '%' : 'OFF'}`;
      if (p2Dot) p2Dot.className = p2.on ? 'w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_#4edea3] animate-pulse' : 'w-2 h-2 rounded-full bg-outline';
      if (p2Pill) p2Pill.className = p2.on ? 'flex-1 bg-secondary/15 border border-secondary/40 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 shadow-[0_0_12px_rgba(78,222,163,0.15)]' : 'flex-1 bg-surface-container-high/40 border border-outline-variant/30 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 opacity-70';

      const inletRate = document.getElementById('inlet-rate-label');
      const outletRate = document.getElementById('outlet-rate-label');
      if (inletRate) inletRate.textContent = p1.on ? `${(p1.speed * 0.8).toFixed(1)} mL/s` : '0.0 mL/s';
      if (outletRate) outletRate.textContent = p2.on ? `${(p2.speed * 0.6).toFixed(1)} mL/s` : '0.0 mL/s';
    }

    const flowText = document.getElementById('text-flow');
    const flowIcon = document.getElementById('icon-flow');
    const flowPill = document.getElementById('pill-flow');
    if (flowText) flowText.textContent = `FLOW: ${isFlowConfirmed ? 'CONFIRMED' : 'DRY'}`;
    if (flowIcon) flowIcon.className = isFlowConfirmed ? 'w-3.5 h-3.5 text-secondary' : 'w-3.5 h-3.5 text-outline';
    if (flowPill) flowPill.className = isFlowConfirmed ? 'flex-1 bg-secondary/15 border border-secondary/40 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 shadow-[0_0_12px_rgba(78,222,163,0.15)]' : 'flex-1 bg-surface-container-high/40 border border-outline-variant/30 rounded-xl px-2 py-2 flex items-center justify-center space-x-1';

    // 5. Control Tab State
    const isAuto = data.mode === 'auto';
    const btnAuto = document.getElementById('btn-mode-auto');
    const btnManual = document.getElementById('btn-mode-manual');
    const dotAuto = document.getElementById('dot-mode-auto');
    const dotManual = document.getElementById('dot-mode-manual');
    const modeDescText = document.getElementById('mode-desc-text');
    const modeDescBadge = document.getElementById('mode-desc-badge');

    if (btnAuto && btnManual) {
      if (isAuto) {
        btnAuto.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary-container text-on-primary font-headline-md text-xs font-bold shadow-[0_0_16px_rgba(0,212,255,0.45)] transition-all';
        btnManual.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-on-surface-variant font-label-md text-xs hover:text-on-surface transition-all opacity-60';
        if (dotAuto) dotAuto.className = 'h-2 w-2 rounded-full bg-slate-950';
        if (dotManual) dotManual.className = 'h-2 w-2 rounded-full bg-outline-variant';
        if (modeDescText) modeDescText.textContent = 'AUTO: Water level automation regulates spillway gate';
        if (modeDescBadge) {
          modeDescBadge.textContent = 'AUTO ACTIVE';
          modeDescBadge.className = 'px-1.5 py-0.5 rounded text-[9px] bg-cyan-950 text-cyan-400 font-bold border border-cyan-500/30';
        }
      } else {
        btnManual.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500 text-slate-950 font-headline-md text-xs font-bold shadow-[0_0_16px_rgba(16,185,129,0.5)] transition-all';
        btnAuto.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-on-surface-variant font-label-md text-xs hover:text-on-surface transition-all opacity-60';
        if (dotManual) dotManual.className = 'h-2 w-2 rounded-full bg-slate-950';
        if (dotAuto) dotAuto.className = 'h-2 w-2 rounded-full bg-outline-variant';
        if (modeDescText) modeDescText.textContent = 'MANUAL: Direct operator control over SG90 gate servo';
        if (modeDescBadge) {
          modeDescBadge.textContent = 'MANUAL OVERRIDE';
          modeDescBadge.className = 'px-1.5 py-0.5 rounded text-[9px] bg-emerald-950 text-emerald-400 font-bold border border-emerald-500/30';
        }
      }
    }

    // Tactical Arc Dial & Needle
    const targetAngle = Number((data.gate && data.gate.target !== undefined) ? data.gate.target : 0);
    const actualAngle = Number((data.gate && data.gate.actual !== undefined) ? data.gate.actual : targetAngle);
    ui.updateDial(targetAngle, actualAngle);

    // Interlock state card
    const interlockCard = document.getElementById('proximity-hazard-card');
    const ctrlInterlockBadge = document.getElementById('ctrl-interlock-badge');
    if (data.interlocked) {
      if (interlockCard) interlockCard.classList.remove('hidden');
      if (ctrlInterlockBadge) {
        ctrlInterlockBadge.className = 'flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/20 border border-amber-500/50 text-amber-400 font-bold';
        ctrlInterlockBadge.innerHTML = '<svg class="w-3.5 h-3.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg><span class="font-label-sm text-[10px]">INTERLOCKED</span>';
      }
    } else {
      if (interlockCard) interlockCard.classList.add('hidden');
      if (ctrlInterlockBadge) {
        ctrlInterlockBadge.className = 'flex items-center gap-1.5 px-2 py-1 rounded bg-secondary-container/10 border border-secondary/30 text-secondary';
        ctrlInterlockBadge.innerHTML = '<svg class="w-3.5 h-3.5 inline-block" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/></svg><span class="font-label-sm text-[10px]">CLEAR</span>';
      }
    }

    // Pumps Controls
    if (data.pumps && data.pumps.length >= 2) {
      const p1 = data.pumps[0];
      const p2 = data.pumps[1];
      ui.updatePumpSwitch(1, !!p1.on, p1.speed !== undefined ? p1.speed : 100, p1.runtimeS || 0);
      ui.updatePumpSwitch(2, !!p2.on, p2.speed !== undefined ? p2.speed : 100, p2.runtimeS || 0);
    }

    // ── Hydro-Electric Turbine Demo Telemetry ───────────────
    const turbine = data.turbine || {};
    const isTurbineOn = !!turbine.on;
    const turbSpeed = turbine.speed || 0;
    const turbVolt = (turbine.voltage || 0).toFixed(2);
    const turbCurr = (turbine.currentMa || 0).toFixed(1);
    const turbPower = (turbine.powerMw || 0).toFixed(1);
    const turbRpm = turbine.rpm || 0;

    // Overview Tab elements
    const tHomeVolt = document.getElementById('turbine-volt-home');
    const tHomeCurr = document.getElementById('turbine-curr-home');
    const tHomePower = document.getElementById('turbine-power-home');
    const tHomeRpm = document.getElementById('turbine-rpm-home');
    const tHomeBadge = document.getElementById('turbine-home-badge');
    const tHomeIcon = document.getElementById('turbine-home-icon');
    const tQuickBtn = document.getElementById('turbine-quick-btn');
    const tQuickBtnLabel = document.getElementById('turbine-quick-btn-label');

    if (tHomeVolt) tHomeVolt.textContent = turbVolt;
    if (tHomeCurr) tHomeCurr.textContent = turbCurr;
    if (tHomePower) tHomePower.textContent = turbPower;
    if (tHomeRpm) tHomeRpm.textContent = turbRpm;
    if (tHomeBadge) {
      tHomeBadge.textContent = isTurbineOn ? `RUNNING (${turbSpeed}%)` : 'STANDBY';
      tHomeBadge.className = isTurbineOn ?
        'px-2 py-0.5 rounded-full font-label-sm text-[10px] font-bold bg-primary-container/20 text-primary-container border border-primary-container/40 shadow-[0_0_8px_#00d4ff]' :
        'px-2 py-0.5 rounded-full font-label-sm text-[10px] font-bold bg-surface-container text-on-surface-variant border border-outline-variant/30';
    }
    if (tHomeIcon) {
      if (isTurbineOn) tHomeIcon.classList.add('animate-spin');
      else tHomeIcon.classList.remove('animate-spin');
    }
    if (tQuickBtnLabel) tQuickBtnLabel.textContent = isTurbineOn ? 'STOP TURBINE' : 'TURN ON DEMO';
    if (tQuickBtn) {
      tQuickBtn.className = isTurbineOn ?
        'px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 border border-red-500 text-xs font-label-sm font-bold text-white transition-all flex items-center space-x-1.5' :
        'px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright border border-outline-variant/30 text-xs font-label-sm font-bold text-on-surface transition-all flex items-center space-x-1.5';
    }

    // Control Tab elements
    const tCtrlVolt = document.getElementById('turbine-ctrl-volt');
    const tCtrlCurr = document.getElementById('turbine-ctrl-curr');
    const tCtrlPower = document.getElementById('turbine-ctrl-power');
    const tCtrlRpm = document.getElementById('turbine-ctrl-rpm');
    const tCtrlBadge = document.getElementById('turbine-ctrl-badge');
    const tCtrlIcon = document.getElementById('turbine-ctrl-icon');
    const tRelayState = document.getElementById('turbine-relay-state');
    const btnTurbOff = document.getElementById('btn-turbine-off');
    const btnTurbOn = document.getElementById('btn-turbine-on');
    const tSpeedSlider = document.getElementById('turbine-speed-slider');
    const tSpeedLabel = document.getElementById('turbine-speed-label');

    if (tCtrlVolt) tCtrlVolt.textContent = `${turbVolt} V`;
    if (tCtrlCurr) tCtrlCurr.textContent = `${turbCurr} mA`;
    if (tCtrlPower) tCtrlPower.textContent = `${turbPower} mW`;
    if (tCtrlRpm) tCtrlRpm.textContent = `${turbRpm} RPM`;

    ui.updateTurbineSwitch(isTurbineOn, turbSpeed, turbine.runtimeS || 0);

    // ── Disconnected Sensor & Proximity Auto-Warning Banners ─
    const sensors = data.sensors || {};
    const usDisconnected = !!sensors.ultrasonicDisconnected;
    const gasDisconnected = !!sensors.gasDisconnected || (data.gas && data.gas.level === 'DISCONNECTED');
    const probeFault = !!data.level?.probeFault;
    const anySensorFault = usDisconnected || gasDisconnected || probeFault || !!sensors.anyFault;

    const faultBanner = document.getElementById('sensor-fault-banner');
    const faultDetail = document.getElementById('sensor-fault-detail');
    if (faultBanner) {
      if (anySensorFault) {
        faultBanner.classList.remove('hidden');
        let details = [];
        if (usDisconnected) details.push('HC-SR04 ECHO TIMEOUT / DETACHED');
        if (gasDisconnected) details.push('MQ-135 OPEN CIRCUIT / DISCONNECTED');
        if (probeFault) details.push('WATER PROBE FAULT / INVERTED');
        if (faultDetail) faultDetail.textContent = details.length > 0 ? details.join(' • ') : 'CRITICAL HARDWARE DETACHMENT';
      } else {
        faultBanner.classList.add('hidden');
      }
    }

    const proxZone = data.proximity ? (data.proximity.zone || 'CLEAR') : 'CLEAR';
    const proxWarnBanner = document.getElementById('prox-warning-banner');
    const proxWarnDetail = document.getElementById('prox-warning-detail');
    if (proxWarnBanner) {
      if (proxZone !== 'CLEAR') {
        proxWarnBanner.classList.remove('hidden');
        const pDist = data.proximity && data.proximity.distanceCm !== undefined ? data.proximity.distanceCm.toFixed(1) : '?';
        if (proxZone === 'DANGER') {
          proxWarnBanner.className = 'rounded-2xl p-3 bg-red-950/90 border border-red-500 shadow-[0_0_25px_rgba(239,68,68,0.4)] flex items-center justify-between text-red-200 animate-pulse';
          if (proxWarnDetail) proxWarnDetail.textContent = `CRITICAL HAZARD: Obstacle at ${pDist}cm! Emergency gate lockout active.`;
        } else {
          proxWarnBanner.className = 'rounded-2xl p-3 bg-amber-950/90 border border-amber-500 shadow-[0_0_25px_rgba(245,158,11,0.4)] flex items-center justify-between text-amber-200';
          if (proxWarnDetail) proxWarnDetail.textContent = `AUTO-WARNING: Obstacle at ${pDist}cm approaching gate. Motion paused.`;
        }
      } else {
        proxWarnBanner.classList.add('hidden');
      }
    }

    // 6. Sensors Tab State
    const wires = data.level ? (data.level.wires || {}) : {};
    ['flow', 'warning', 'high', 'medium', 'low'].forEach(k => {
      const isWet = !!wires[k];
      const dot = document.getElementById(`dot-wire-${k}`);
      const stateLbl = document.getElementById(`state-wire-${k}`);
      const row = document.getElementById(`wire-row-${k}`);

      if (dot) dot.className = isWet ? 'w-2 h-2 rounded-full bg-primary-container shadow-[0_0_6px_#00d4ff]' : 'w-2 h-2 rounded-full bg-outline-variant';
      if (stateLbl) {
        stateLbl.textContent = isWet ? 'WET' : 'DRY';
        stateLbl.className = isWet ? 'px-2 py-0.5 rounded font-label-sm text-[10px] bg-primary-container/15 text-primary-container border border-primary-container/30' : 'px-2 py-0.5 rounded font-label-sm text-[10px] bg-surface-variant text-outline border border-outline-variant/30';
      }
    });

    const sVerticalBar = document.getElementById('sensors-vertical-bar');
    const sPctLbl = document.getElementById('sensors-pct-label');
    if (sVerticalBar) sVerticalBar.style.height = `${Math.max(5, Math.min(100, levelPct))}%`;
    if (sPctLbl) sPctLbl.textContent = `${levelPct}% LVL`;

    // Ultrasonic Live Calibration Readout
    const sDistEcho = document.getElementById('sensors-dist-echo');
    const sDepthEcho = document.getElementById('sensors-depth-echo');
    if (sDistEcho) {
      sDistEcho.textContent = waterDist > 0 ? `${waterDist.toFixed(1)} cm` : '-- cm';
    }
    if (sDepthEcho) {
      sDepthEcho.textContent = depthCm >= 0 ? `${depthCm.toFixed(1)} cm (${depthIn.toFixed(1)}")` : '-- cm';
    }

    // MQ-135 Gas Telemetry
    const gas = data.gas || {};
    const rawVal = gas.raw || 0;
    const gasNeedle = document.getElementById('svg-gas-needle');
    const gasMarker = document.getElementById('gas-now-marker');
    const gasLarge = document.getElementById('gas-metric-large');
    const mqWarmup = document.getElementById('mq-warmup-pill');
    const mqLevel = document.getElementById('mq-level-pill');

    if (gasNeedle) {
      // Map 0-4095 to -90 deg to +90 deg
      const rot = -90 + ((rawVal / 4095) * 180);
      gasNeedle.setAttribute('transform', `translate(120, 120) rotate(${rot})`);
    }
    if (gasMarker) gasMarker.textContent = `${rawVal} [NOW]`;
    if (gasLarge) gasLarge.innerHTML = `${rawVal} <span class="font-label-md text-xs text-outline font-normal">raw ADC</span>`;
    if (mqWarmup) {
      if (gas.warmupS > 0) {
        mqWarmup.textContent = `WARM-UP: ${gas.warmupS}s`;
        mqWarmup.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30';
      } else {
        mqWarmup.textContent = 'READY';
        mqWarmup.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-secondary-container/20 text-secondary border border-secondary/30';
      }
    }
    if (mqLevel) {
      const lvl = gas.level || 'NORMAL';
      mqLevel.textContent = lvl;
      if (lvl === 'DANGER') mqLevel.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-red-950/40 text-error border border-error/50 font-bold';
      else if (lvl === 'WARNING') mqLevel.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30';
      else mqLevel.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-secondary-container/20 text-secondary border border-secondary/30';
    }

    const gasPill = document.getElementById('gas-disconnect-pill');
    if (gasPill) {
      if (gasDisconnected) {
        gasPill.textContent = 'DISCONNECTED';
        gasPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-red-950/80 text-error border border-error animate-pulse font-bold';
      } else {
        gasPill.textContent = 'ONLINE';
        gasPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-secondary-container/20 text-secondary border border-secondary/30';
      }
    }

    // HC-SR04 Radar Telemetry
    const prox = data.proximity || {};
    const radarPill = document.getElementById('radar-zone-pill');
    const radarDist = document.getElementById('radar-dist-metric');
    const radarBlip = document.getElementById('radar-blip-target');
    const distCm = prox.distanceCm !== undefined ? prox.distanceCm : 50;

    const usPill = document.getElementById('us-disconnect-pill');
    if (usPill) {
      if (usDisconnected) {
        usPill.textContent = 'DISCONNECTED (0-ECHO)';
        usPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-red-950/80 text-error border border-error animate-pulse font-bold';
      } else {
        usPill.textContent = 'ONLINE';
        usPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-secondary-container/20 text-secondary border border-secondary/30';
      }
    }

    if (radarDist) radarDist.innerHTML = `${distCm.toFixed(1)} <span class="font-label-md text-xs text-outline font-normal">cm</span>`;
    if (radarPill) {
      const zone = prox.zone || 'CLEAR';
      radarPill.textContent = `ZONE: ${zone} (${distCm.toFixed(1)}cm)`;
      if (zone === 'DANGER') radarPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-red-950/40 text-error border border-error/50 font-bold animate-pulse';
      else if (zone === 'WARNING') radarPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 font-semibold';
      else radarPill.className = 'px-2 py-0.5 rounded-full font-label-sm text-[10px] bg-primary-container/15 text-primary-container border border-primary-container/30';
    }
    if (radarBlip) {
      // Map distance (0-60cm) to radius on radar
      const rRatio = Math.max(0.1, Math.min(1.0, distCm / 60));
      radarBlip.style.top = `${25 + (1 - rRatio) * 40}px`;
      radarBlip.style.right = `${35 + (1 - rRatio) * 35}px`;
      radarBlip.className = distCm < 15 ? 'absolute w-3 h-3 rounded-full bg-error z-10 shadow-[0_0_12px_#ef4444] animate-ping' : (distCm < 40 ? 'absolute w-3 h-3 rounded-full bg-amber-400 z-10 shadow-[0_0_10px_#f59e0b]' : 'absolute w-3 h-3 rounded-full bg-primary-container z-10 shadow-[0_0_10px_#00d4ff]');
    }

    // System Health
    const uptimeEl = document.getElementById('sys-uptime-val');
    const heapEl = document.getElementById('sys-heap-val');
    const clientsEl = document.getElementById('sys-clients-val');
    const fwEl = document.getElementById('sys-fw-val');

    if (uptimeEl && data.uptime !== undefined) {
      const hrs = Math.floor(data.uptime / 3600);
      const mins = Math.floor((data.uptime % 3600) / 60);
      const secs = data.uptime % 60;
      uptimeEl.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }
    if (heapEl && data.freeHeap) heapEl.textContent = `${Math.round(data.freeHeap / 1024)} KB`;
    if (clientsEl && data.wsClients !== undefined) clientsEl.textContent = `${data.wsClients} conn`;
    if (fwEl && data.fwVersion) fwEl.textContent = `v${data.fwVersion}`;

    // 7. System / Wiring Test Diagnostic Board
    ['low', 'medium', 'high', 'warning', 'flow'].forEach(k => {
      const isWet = !!wires[k];
      const dot = document.getElementById(`wt-dot-${k}`);
      const txt = document.getElementById(`wt-text-${k}`);
      if (dot) dot.className = isWet ? 'w-2 h-2 rounded-full bg-primary-container shadow-[0_0_6px_#00d4ff]' : 'w-2 h-2 rounded-full bg-outline-variant';
      if (txt) {
        txt.textContent = isWet ? 'WET' : 'DRY';
        txt.className = isWet ? 'font-label-sm text-primary-container font-mono text-[9px]' : 'font-label-sm text-outline font-mono text-[9px]';
      }
    });

    const wtUltra = document.getElementById('wt-ultrasonic-val');
    const wtGas = document.getElementById('wt-gas-val');
    if (wtUltra) wtUltra.textContent = `${distCm.toFixed(1)} cm`;
    if (wtGas) wtGas.textContent = `${rawVal} ADC (${gas.level || 'NORMAL'})`;

    // History Canvas update
    if (window.chartView && data.history) chartView.update(data.history);
    } catch (err) {
      console.warn('[AquaGuard SCADA] State update error:', err);
    }
  },

  startWatchdog() {
    setInterval(() => {
      if (this.isOffline) {
        fetch(this.apiBase + '/api/state')
          .then(res => res.json())
          .then(d => this.handleStateUpdate(d))
          .catch(() => {});
      }
    }, 2500);
  }
};
window.app = app;

/**
 * REST / WebSocket API Client
 */
const api = {
  send(endpoint, body) {
    const cleanEndpoint = endpoint.split('?')[0];
    const cmd = cleanEndpoint.replace('/api/', '');
    const payload = { cmd, ...body };

    // 1. Send via WebSocket if connected (<5ms low-latency dispatch)
    if (app.ws && app.ws.readyState === WebSocket.OPEN) {
      try {
        app.ws.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('[AquaGuard] WS error:', e);
      }
    }

    // 2. ALSO send via HTTP POST with URL query parameters + JSON body
    return fetch(app.apiBase + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(r => r.json().catch(() => ({ ok: true })))
    .then(data => {
      setTimeout(() => app.fetchState(), 100);
      return data;
    })
    .catch(e => {
      console.warn('[AquaGuard SCADA] API POST error, trying fallback:', e);
      return fetch(app.apiBase + endpoint).catch(() => ({ ok: true }));
    });
  },

  setGate(angle) {
    const val = parseInt(angle, 10);
    return this.send(`/api/gate?angle=${val}`, { angle: val });
  },

  setPump(id, on, speed) {
    const s = parseInt(speed, 10);
    const body = { id, on: !!on, speed: s };
    return this.send(`/api/pump?id=${id}&on=${on}&speed=${s}`, body);
  },

  setTurbine(on, speed) {
    const s = parseInt(speed, 10);
    return this.send(`/api/turbine?on=${on}&speed=${s}`, { on: !!on, speed: s });
  },

  setMode(mode) {
    try { sound.playModeSwitch(mode); } catch (e) {}
    app._modeLockUntil = Date.now() + 5000;
    if (!app.state) app.state = {};
    app.state.mode = mode;
    app.handleStateUpdate(app.state);
    return this.send(`/api/mode?mode=${mode}`, { mode });
  },

  override(confirm) {
    sound.playWarningAlert();
    return this.send('/api/override', { confirm: !!confirm });
  },

  ack() {
    sound.playSuccess();
    return this.send('/api/ack', { ack: true });
  },

  saveSettings(payload) {
    return this.send('/api/settings', payload);
  },

  fetchLog() {
    fetch('/api/log')
      .then(r => r.json())
      .then(data => {
        const list = document.getElementById('log-list');
        if (!list) return;
        const events = data.events || data;
        if (!events || events.length === 0) return;
        list.innerHTML = events.slice(-15).reverse().map(e => {
          const time = typeof e.ts === 'number' ? new Date(e.ts * 1000).toLocaleTimeString() : '--:--:--';
          const color = e.level === 3 ? '#ef4444' : (e.level === 2 ? '#f59e0b' : '#00d4ff');
          return `<div class="p-2 rounded bg-surface-container-lowest/80 border border-outline-variant/30 text-xs font-mono flex items-start space-x-2">
            <span style="color:${color}">●</span>
            <span class="text-outline">[${time}]</span>
            <span class="text-on-surface flex-1">${e.msg}</span>
          </div>`;
        }).join('');
      })
      .catch(() => {});
  }
};
window.api = api;

/**
 * UI Event Handlers and Navigation
 */
const ui = {
  switchTab(tabId) {
    app.activeTab = tabId;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.className = 'flex-1 flex flex-col items-center justify-center py-1.5 text-slate-400 hover:text-cyan-400 active:scale-95 transition-all duration-150 min-h-[48px] nav-btn';
      const ind = btn.querySelector('.nav-indicator');
      if (ind) ind.className = 'w-4 h-0.5 bg-transparent rounded-full mt-0.5 nav-indicator';
    });

    const activePanel = document.getElementById(`tab-${tabId}`);
    const activeBtn = document.getElementById(`nav-btn-${tabId}`);
    if (activePanel) activePanel.classList.add('active');
    if (activeBtn) {
      activeBtn.className = 'flex-1 flex flex-col items-center justify-center py-1.5 text-cyan-400 drop-shadow-[0_0_8px_rgba(0,212,255,0.6)] active:scale-95 transition-all duration-150 min-h-[48px] nav-btn font-bold';
      const ind = activeBtn.querySelector('.nav-indicator');
      if (ind) ind.className = 'w-5 h-0.5 bg-cyan-400 rounded-full mt-0.5 shadow-[0_0_8px_#00d4ff] nav-indicator';
    }
    sound.playClick();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  updateDial(angle, actual) {
    const targetAngle = Number(angle);
    const actualAngle = actual !== undefined ? Number(actual) : targetAngle;
    const dialArc = document.getElementById('svg-dial-arc');
    const dialNeedle = document.getElementById('svg-dial-needle');
    const dialAngleDisp = document.getElementById('dial-angle-display');
    const dialAngleSub = document.getElementById('dial-angle-sub');
    const dialAngleActual = document.getElementById('dial-angle-actual');
    const range = document.getElementById('gate-range-input');
    const lbl = document.getElementById('slider-val-label');

    if (dialArc) {
      // Circumference for r=60 is ~377. 240 deg sweep = 251.33 dash length
      const arcLength = (Math.max(0, Math.min(100, targetAngle)) / 100) * 251.33;
      dialArc.setAttribute('stroke-dasharray', `${arcLength.toFixed(1)} 377`);
    }
    if (dialNeedle) {
      // Needle sweeps 240 deg from -120 deg (0%) to +120 deg (100%) around center (80, 80)
      const needleDeg = -120 + ((Math.max(0, Math.min(100, targetAngle)) / 100) * 240);
      dialNeedle.setAttribute('transform', `rotate(${needleDeg.toFixed(1)} 80 80)`);
    }
    if (dialAngleDisp) dialAngleDisp.textContent = `${targetAngle.toFixed(1)}°`;
    if (dialAngleSub) {
      if (targetAngle === 0) dialAngleSub.textContent = 'CLOSED';
      else if (targetAngle >= 95) dialAngleSub.textContent = 'MAX FLOOD RELIEF';
      else if (targetAngle >= 50) dialAngleSub.textContent = 'HIGH DISCHARGE';
      else dialAngleSub.textContent = 'PARTIAL DRAFT';
    }
    if (dialAngleActual) dialAngleActual.textContent = `ACTUAL: ${actualAngle.toFixed(1)}°`;
    if (range && document.activeElement !== range) range.value = targetAngle;
    if (lbl) lbl.textContent = `TARGET: ${targetAngle}°`;
  },

  updatePumpSwitch(id, isOn, speed, runtimeS) {
    const sw = document.getElementById(`switch-pump${id}`);
    const knob = document.getElementById(`knob-pump${id}`);
    const badge = document.getElementById(`pump${id}-status-badge`);
    const relay = document.getElementById(`pump${id}-relay-state`);
    const speedLbl = document.getElementById(`pump${id}-speed-label`);
    const slider = document.getElementById(`pump${id}-speed-slider`);
    const runtimeEl = document.getElementById(`pump${id}-runtime-display`);
    const btnOn = document.getElementById(`btn-pump${id}-on`);
    const btnOff = document.getElementById(`btn-pump${id}-off`);

    if (sw && knob) {
      if (isOn) {
        sw.className = 'relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 border-emerald-400 bg-emerald-500 transition-colors duration-200 ease-in-out focus:outline-none shadow-[0_0_14px_rgba(16,185,129,0.55)]';
        knob.className = 'pointer-events-none inline-block h-6 w-6 m-0.5 transform rounded-full bg-slate-950 shadow-md transition duration-200 ease-in-out translate-x-8';
        sw.setAttribute('aria-checked', 'true');
      } else {
        sw.className = 'relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 border-slate-700 bg-slate-800 transition-colors duration-200 ease-in-out focus:outline-none shadow-inner';
        knob.className = 'pointer-events-none inline-block h-6 w-6 m-0.5 transform rounded-full bg-slate-400 shadow-md transition duration-200 ease-in-out translate-x-0';
        sw.setAttribute('aria-checked', 'false');
      }
    }

    if (btnOn && btnOff) {
      if (isOn) {
        btnOn.className = 'px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-sm text-xs font-bold shadow-[0_0_12px_rgba(78,222,163,0.5)]';
        btnOff.className = 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      } else {
        btnOff.className = 'px-3 py-1.5 rounded-lg text-on-surface font-label-sm text-xs font-bold bg-surface-container-high border border-outline-variant/30';
        btnOn.className = 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      }
    }

    if (badge) {
      badge.textContent = isOn ? 'ACTIVE / RUNNING' : 'STANDBY';
      badge.className = isOn
        ? 'px-2.5 py-1 rounded-full text-[10px] font-label-sm font-bold bg-emerald-950/40 text-emerald-400 border border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
        : 'px-2.5 py-1 rounded-full text-[10px] font-label-sm font-bold bg-surface-container text-on-surface-variant border border-outline-variant/40';
    }

    if (relay) {
      const spd = speed !== undefined ? speed : 100;
      relay.textContent = isOn ? `MJE3055T ACTIVE (${spd}%)` : 'RELAY IDLE';
      relay.className = isOn
        ? 'font-label-md text-xs font-bold flex items-center gap-1.5 text-emerald-400'
        : 'font-label-md text-xs font-bold flex items-center gap-1.5 text-on-surface-variant';
    }

    if (speedLbl && speed !== undefined) speedLbl.textContent = `${speed}%`;
    if (slider && speed !== undefined && document.activeElement !== slider) slider.value = speed;

    if (runtimeEl) {
      if (isOn) {
        if (typeof runtimeS === 'number' && runtimeS > 0) {
          const m = Math.floor(runtimeS / 60);
          const s = runtimeS % 60;
          runtimeEl.textContent = `RUNNING: ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
          runtimeEl.textContent = 'RUNNING: ACTIVE';
        }
        runtimeEl.className = 'font-label-sm text-[10px] text-emerald-400 font-mono block mt-0.5 font-bold';
      } else {
        runtimeEl.textContent = 'STANDBY';
        runtimeEl.className = 'font-label-sm text-[10px] text-slate-400 font-mono block mt-0.5';
      }
    }
  },

  updateTurbineSwitch(isOn, speed, runtimeS) {
    const sw = document.getElementById('switch-turbine');
    const knob = document.getElementById('knob-turbine');
    const badge = document.getElementById('turbine-ctrl-badge');
    const relay = document.getElementById('turbine-relay-state');
    const icon = document.getElementById('turbine-ctrl-icon');
    const speedLbl = document.getElementById('turbine-speed-label');
    const slider = document.getElementById('turbine-speed-slider');
    const runtimeEl = document.getElementById('turbine-runtime-display');
    const btnTurbOff = document.getElementById('btn-turbine-off');
    const btnTurbOn = document.getElementById('btn-turbine-on');

    if (sw && knob) {
      if (isOn) {
        sw.className = 'relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 border-primary-container bg-primary-container transition-colors duration-200 ease-in-out focus:outline-none shadow-[0_0_14px_rgba(0,212,255,0.55)]';
        knob.className = 'pointer-events-none inline-block h-6 w-6 m-0.5 transform rounded-full bg-slate-950 shadow-md transition duration-200 ease-in-out translate-x-8';
        sw.setAttribute('aria-checked', 'true');
      } else {
        sw.className = 'relative inline-flex h-8 w-16 shrink-0 cursor-pointer rounded-full border-2 border-slate-700 bg-slate-800 transition-colors duration-200 ease-in-out focus:outline-none shadow-inner';
        knob.className = 'pointer-events-none inline-block h-6 w-6 m-0.5 transform rounded-full bg-slate-400 shadow-md transition duration-200 ease-in-out translate-x-0';
        sw.setAttribute('aria-checked', 'false');
      }
    }

    if (btnTurbOff && btnTurbOn) {
      if (isOn) {
        btnTurbOn.className = 'px-3 py-1.5 rounded-lg font-label-sm text-xs font-bold bg-primary-container text-surface-container-lowest shadow-[0_0_8px_#00d4ff]';
        btnTurbOff.className = 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      } else {
        btnTurbOff.className = 'px-3 py-1.5 rounded-lg text-on-surface font-label-sm text-xs font-bold bg-surface-container-high border border-outline-variant/30';
        btnTurbOn.className = 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      }
    }

    if (badge) {
      badge.textContent = isOn ? `ONLINE • ${speed}%` : 'STANDBY';
      badge.className = isOn
        ? 'px-2.5 py-1 rounded-full text-[10px] font-label-sm font-bold bg-primary-container/20 text-primary-container border border-primary-container/40 shadow-[0_0_8px_#00d4ff]'
        : 'px-2.5 py-1 rounded-full text-[10px] font-label-sm font-bold bg-surface-container text-on-surface-variant border border-outline-variant/40';
    }

    if (relay) {
      relay.textContent = isOn ? `GENERATING • ${speed}% PWM` : 'RELAY IDLE';
      relay.className = isOn
        ? 'font-label-md text-xs font-bold flex items-center gap-1.5 text-primary-container'
        : 'font-label-md text-xs font-bold flex items-center gap-1.5 text-on-surface-variant';
    }

    if (icon) {
      if (isOn) icon.classList.add('animate-spin');
      else icon.classList.remove('animate-spin');
    }

    if (speedLbl && speed !== undefined) speedLbl.textContent = `${speed}%`;
    if (slider && speed !== undefined && document.activeElement !== slider) slider.value = speed;

    if (runtimeEl) {
      if (isOn) {
        if (typeof runtimeS === 'number' && runtimeS > 0) {
          const m = Math.floor(runtimeS / 60);
          const s = runtimeS % 60;
          runtimeEl.textContent = `RUNNING: ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
          runtimeEl.textContent = 'RUNNING: ACTIVE';
        }
        runtimeEl.className = 'font-label-sm text-[10px] text-cyan-400 font-mono block mt-0.5 font-bold';
      } else {
        runtimeEl.textContent = 'STANDBY';
        runtimeEl.className = 'font-label-sm text-[10px] text-slate-400 font-mono block mt-0.5';
      }
    }
  },

  setMode(m) {
    try { sound.playModeSwitch(m); } catch (e) {}
    app._modeLockUntil = Date.now() + 5000;
    if (!app.state) app.state = {};
    app.state.mode = m;
    app.handleStateUpdate(app.state);
    api.setMode(m);
  },

  setGateQuick(deg) {
    try { sound.playClick(); } catch (e) {}
    const val = parseInt(deg, 10);
    this.updateDial(val);
    app._gateLockUntil = Date.now() + 4000;
    app._modeLockUntil = Date.now() + 4000;
    if (!app.state) app.state = {};
    app.state.mode = 'manual';
    if (!app.state.gate) app.state.gate = {};
    app.state.gate.target = val;
    api.setGate(val);
  },

  onGateSlider(deg) {
    try { sound.playTick(); } catch (e) {}
    const val = parseInt(deg, 10);
    this.updateDial(val);
    app._gateLockUntil = Date.now() + 4000;
    app._modeLockUntil = Date.now() + 4000;
    if (!app.state) app.state = {};
    app.state.mode = 'manual';
    if (!app.state.gate) app.state.gate = {};
    app.state.gate.target = val;
    if (this._gateDebounce) clearTimeout(this._gateDebounce);
    this._gateDebounce = setTimeout(() => {
      api.setGate(val);
    }, 40);
  },

  togglePump(id) {
    const idx = id - 1;
    const currentOn = !!(app.state && app.state.pumps && app.state.pumps[idx] && app.state.pumps[idx].on);
    this.onPumpToggle(id, !currentOn);
  },

  setPumpDirection(id, reverse) {
    // Deprecated for MJE3055T single-direction control
  },

  onPumpToggle(id, on) {
    try { sound.playClick(); } catch (e) {}
    const idx = id - 1;
    const slider = document.getElementById(`pump${id}-speed-slider`);
    const speed = on ? (slider && parseInt(slider.value, 10) > 0 ? parseInt(slider.value, 10) : 100) : 0;
    if (slider && on && parseInt(slider.value, 10) === 0) slider.value = 100;

    // Instant local tactile switch & badge update
    this.updatePumpSwitch(id, on, speed, on ? 1 : 0);

    // Also update Quick Status row on Overview tab
    const pText = document.getElementById(`text-pump${id}`);
    const pDot = document.getElementById(`dot-pump${id}`);
    const pPill = document.getElementById(`pill-pump${id}`);
    if (pText) pText.textContent = `PUMP ${id}: ${on ? speed + '%' : 'OFF'}`;
    if (pDot) pDot.className = on ? 'w-2 h-2 rounded-full bg-secondary shadow-[0_0_6px_#4edea3] animate-pulse' : 'w-2 h-2 rounded-full bg-outline';
    if (pPill) pPill.className = on ? 'flex-1 bg-secondary/15 border border-secondary/40 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 shadow-[0_0_12px_rgba(78,222,163,0.15)]' : 'flex-1 bg-surface-container-high/40 border border-outline-variant/30 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 opacity-70';

    app._pumpLockUntil = Date.now() + 4000;
    if (!app.state) app.state = {};
    if (!app.state.pumps) app.state.pumps = [{}, {}];
    app.state.pumps[idx] = { id, on: !!on, speed, runtimeS: on ? 1 : 0 };

    api.setPump(id, on, speed);
  },

  onPumpSpeed(id, val) {
    const lbl = document.getElementById(`pump${id}-speed-label`);
    if (lbl) lbl.textContent = `${val}%`;
    const idx = id - 1;
    const isCurrentlyOn = !!(app.state && app.state.pumps && app.state.pumps[idx] && app.state.pumps[idx].on);

    if (this[`_pDebounce${id}`]) clearTimeout(this[`_pDebounce${id}`]);
    this[`_pDebounce${id}`] = setTimeout(() => {
      api.setPump(id, isCurrentlyOn, val);
    }, 60);
  },

  toggleTurbine() {
    const isRunning = !!(app.state && app.state.turbine && app.state.turbine.on);
    this.onTurbineToggle(!isRunning);
  },

  onTurbineToggle(on) {
    try { sound.playClick(); } catch (e) {}
    const slider = document.getElementById('turbine-speed-slider');
    const speed = on ? (slider && parseInt(slider.value, 10) > 0 ? parseInt(slider.value, 10) : 85) : 0;
    if (slider && on && parseInt(slider.value, 10) === 0) slider.value = 85;

    // Instant tactile switch & badge update
    this.updateTurbineSwitch(on, speed, on ? 1 : 0);

    // Also update Quick Button and Badge on Overview tab
    const tHomeBadge = document.getElementById('turbine-home-badge');
    const tHomeIcon = document.getElementById('turbine-home-icon');
    const tQuickBtnLabel = document.getElementById('turbine-quick-btn-label');
    const tQuickBtn = document.getElementById('turbine-quick-btn');

    if (tHomeBadge) {
      tHomeBadge.textContent = on ? `RUNNING (${speed}%)` : 'STANDBY';
      tHomeBadge.className = on ?
        'px-2 py-0.5 rounded-full font-label-sm text-[10px] font-bold bg-primary-container/20 text-primary-container border border-primary-container/40 shadow-[0_0_8px_#00d4ff]' :
        'px-2 py-0.5 rounded-full font-label-sm text-[10px] font-bold bg-surface-container text-on-surface-variant border border-outline-variant/30';
    }
    if (tHomeIcon) {
      if (on) tHomeIcon.classList.add('animate-spin');
      else tHomeIcon.classList.remove('animate-spin');
    }
    if (tQuickBtnLabel) tQuickBtnLabel.textContent = on ? 'STOP TURBINE' : 'TURN ON DEMO';
    if (tQuickBtn) {
      tQuickBtn.className = on ?
        'px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 border border-red-500 text-xs font-label-sm font-bold text-white transition-all flex items-center space-x-1.5' :
        'px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-bright border border-outline-variant/30 text-xs font-label-sm font-bold text-on-surface transition-all flex items-center space-x-1.5';
    }

    app._turbineLockUntil = Date.now() + 4000;
    if (!app.state) app.state = {};
    app.state.turbine = { on: !!on, speed, runtimeS: on ? 1 : 0 };

    api.setTurbine(on, speed);
  },

  onTurbineSpeed(val) {
    const lbl = document.getElementById('turbine-speed-label');
    if (lbl) lbl.textContent = `${val}%`;
    if (this._tDebounce) clearTimeout(this._tDebounce);
    this._tDebounce = setTimeout(() => {
      const on = parseInt(val, 10) > 0;
      api.setTurbine(on, parseInt(val, 10));
    }, 60);
  },

  setTurbinePreset(pct) {
    const slider = document.getElementById('turbine-speed-slider');
    if (slider) slider.value = pct;
    this.onTurbineSpeed(pct);
  },

  onTurbineQuickToggle() {
    this.toggleTurbine();
  },

  showOverrideDialog() {
    this.openDialog(
      '⚠️ Override Safety Interlock',
      'An obstacle is detected within 15 cm of the gate. Forcing gate movement may cause mechanical pinch hazards. Confirm manual override?',
      () => {
        api.override(true);
        this.closeDialog();
      }
    );
  },

  confirmRestart() {
    this.openDialog(
      '⚡ Restart Microcontroller',
      'Reboot the ESP32? The system will reset sensors and briefly drop offline.',
      () => {
        api.send('/api/settings', { action: 'restart' });
        this.closeDialog();
      }
    );
  },

  openDialog(title, body, onConfirm) {
    const backdrop = document.getElementById('dialog-backdrop');
    const titleEl = document.getElementById('dialog-title');
    const bodyEl = document.getElementById('dialog-body');
    const confirmBtn = document.getElementById('dialog-confirm');

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
    if (confirmBtn) confirmBtn.onclick = onConfirm;
    if (backdrop) backdrop.classList.remove('hidden');
  },

  closeDialog() {
    const backdrop = document.getElementById('dialog-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  },

  saveNetwork() {
    const ssid = document.getElementById('ssid-input').value;
    const pass = document.getElementById('pass-input').value;
    if (!ssid) return alert('SSID cannot be blank');
    api.saveSettings({ wifi_ssid: ssid, wifi_pass: pass }).then(() => {
      alert('Network settings updated. ESP32 will use these credentials.');
    });
  },

  saveThresholds() {
    const gasWarn = parseInt(document.getElementById('gas-warn-input').value, 10);
    const gasDanger = parseInt(document.getElementById('gas-danger-input').value, 10);
    const proxClear = parseFloat(document.getElementById('prox-clear-input').value);
    const proxWarn = parseFloat(document.getElementById('prox-warn-input').value);
    const flowTimeout = parseInt(document.getElementById('flow-timeout-input').value, 10);

    api.saveSettings({
      gas_warn: gasWarn,
      gas_danger: gasDanger,
      prox_clear: proxClear,
      prox_warn: proxWarn,
      flow_timeout: flowTimeout
    }).then(() => {
      sound.playSuccess();
      alert('Threshold parameters updated on telemetry bus.');
    });
  }
};
window.ui = ui;

/**
 * AquaGuard SCADA — Web Audio Synthesizer & Haptics Engine
 * 100% Offline, synthesized sound alerts & physical vibration
 */
const sound = {
  ctx: null,
  enabled: true,
  unlocked: false,
  lastCriticalTime: 0,
  lastWarnTime: 0,

  init() {
    try {
      const saved = localStorage.getItem('aquaguard_sound');
      if (saved !== null) {
        this.enabled = saved === 'true';
      }
      this.updateSoundIcon();
    } catch (e) {}
  },

  getCtx() {
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
    } catch (e) {
      this.ctx = null;
    }
    return this.ctx;
  },

  unlock() {
    try {
      const ctx = this.getCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (!this.unlocked) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        this.unlocked = true;
      }
    } catch (e) {}
  },

  toggle() {
    try {
      this.unlock();
      this.enabled = !this.enabled;
      localStorage.setItem('aquaguard_sound', this.enabled ? 'true' : 'false');
      this.updateSoundIcon();
      if (this.enabled) {
        this.playSuccess();
      }
    } catch (e) {}
  },

  updateSoundIcon() {
    try {
      const btn = document.getElementById('sound-toggle-btn');
      if (!btn) return;
      if (this.enabled) {
        btn.innerHTML = '<svg class="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>';
        btn.title = 'Sound Alerts: Enabled';
      } else {
        btn.innerHTML = '<svg class="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path stroke-linecap="round" stroke-linejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>';
        btn.title = 'Sound Alerts: Muted';
      }
    } catch (e) {}
  },

  _executeTone(ctx, freq, durationMs, type, volume) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (durationMs / 1000));

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + (durationMs / 1000));
    } catch (e) {}
  },

  playTone(freq, durationMs, type = 'triangle', volume = 0.35) {
    try {
      if (!this.enabled) return;
      const ctx = this.getCtx();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          this._executeTone(ctx, freq, durationMs, type, volume);
        }).catch(() => {});
        return;
      }
      this._executeTone(ctx, freq, durationMs, type, volume);
    } catch (e) {}
  },

  playCriticalAlarm() {
    try {
      const now = Date.now();
      if (now - this.lastCriticalTime < 2500) return;
      this.lastCriticalTime = now;

      if (!this.enabled) return;
      if ('vibrate' in navigator) {
        try { navigator.vibrate([250, 100, 250, 100, 400]); } catch (e) {}
      }

      const ctx = this.getCtx();
      if (!ctx) return;

      const playSiren = () => {
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.setValueAtTime(587, ctx.currentTime + 0.25);
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.5);
          osc.frequency.setValueAtTime(587, ctx.currentTime + 0.75);

          gain.gain.setValueAtTime(0.4, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 1.1);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start();
          osc.stop(ctx.currentTime + 1.1);
        } catch (e) {}
      };

      if (ctx.state === 'suspended') {
        ctx.resume().then(playSiren).catch(() => {});
      } else {
        playSiren();
      }
    } catch (e) {}
  },

  playWarningAlert() {
    try {
      const now = Date.now();
      if (now - this.lastWarnTime < 3500) return;
      this.lastWarnTime = now;

      if (!this.enabled) return;
      if ('vibrate' in navigator) {
        try { navigator.vibrate(120); } catch (e) {}
      }

      this.playTone(660, 120, 'triangle', 0.35);
      setTimeout(() => this.playTone(660, 140, 'triangle', 0.35), 160);
    } catch (e) {}
  },

  playClick() {
    try {
      if ('vibrate' in navigator) {
        try { navigator.vibrate(15); } catch (e) {}
      }
      this.playTone(1200, 25, 'triangle', 0.25);
    } catch (e) {}
  },

  playTick() {
    try {
      this.playTone(850, 12, 'triangle', 0.15);
    } catch (e) {}
  },

  playModeSwitch(mode) {
    try {
      if (!this.enabled) return;
      if ('vibrate' in navigator) {
        try { navigator.vibrate(mode === 'manual' ? [50, 40, 50] : 60); } catch (e) {}
      }
      if (mode === 'manual') {
        this.playTone(523, 70, 'triangle', 0.35);
        setTimeout(() => this.playTone(880, 120, 'square', 0.25), 80);
      } else {
        this.playTone(880, 70, 'triangle', 0.35);
        setTimeout(() => this.playTone(523, 120, 'triangle', 0.35), 80);
      }
    } catch (e) {}
  },

  playSuccess() {
    try {
      if (!this.enabled) return;
      if ('vibrate' in navigator) {
        try { navigator.vibrate(50); } catch (e) {}
      }
      this.playTone(587, 90, 'triangle', 0.35);
      setTimeout(() => this.playTone(880, 140, 'triangle', 0.35), 100);
    } catch (e) {}
  }
};

window.app = app;
window.api = api;
window.ui = ui;
window.sound = sound;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    app.init();
    api.fetchLog();
  });
} else {
  app.init();
  api.fetchLog();
}
