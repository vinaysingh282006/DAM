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

  init() {
    console.log('[AquaGuard SCADA] Initializing Stitch telemetry bridge...');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host || 'localhost:3000';
    this.wsUrl = `${protocol}//${host}/ws`;

    this.connectWs();
    this.startWatchdog();

    // Check liveness
    setInterval(() => this.checkLiveness(), 1000);
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
    this.state = data;
    this.lastDataTime = Date.now();
    this.setOffline(false);

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
      modeBadge.textContent = `${(data.mode || 'auto').toUpperCase()} MODE • R-ZONE 04`;
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
        if (bannerSub) bannerSub.textContent = data.alarms ? data.alarms.join(' • ') : 'FLOOD / HAZARD LEVEL BREACH';
        if (bannerIcon) bannerIcon.textContent = 'fmd_bad';
        if (bannerIconWrap) bannerIconWrap.className = 'w-10 h-10 rounded-xl bg-error-container/40 border border-error flex items-center justify-center text-error';
        if (ackBtn) ackBtn.classList.remove('hidden');
      } else if (status === 'WARNING') {
        banner.className = 'rounded-2xl p-3 bg-amber-500/15 border border-amber-500/50 flex items-center justify-between shadow-[0_0_20px_rgba(245,158,11,0.3)]';
        bannerTitle.textContent = 'WARNING';
        bannerTitle.className = 'font-headline-lg font-bold text-amber-400 tracking-tight text-xl';
        if (bannerCode) {
          bannerCode.textContent = 'CAUTION';
          bannerCode.className = 'px-1.5 py-0.5 rounded bg-amber-500/20 font-label-sm text-[10px] text-amber-400 font-bold';
        }
        if (bannerSub) bannerSub.textContent = data.alarms ? data.alarms.join(' • ') : 'HIGH LEVEL / PROXIMITY WARN';
        if (bannerIcon) bannerIcon.textContent = 'warning';
        if (bannerIconWrap) bannerIconWrap.className = 'w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500 flex items-center justify-center text-amber-400';
        if (ackBtn) ackBtn.classList.add('hidden');
      } else {
        banner.className = 'rounded-2xl p-3 bg-secondary/10 border border-secondary/40 flex items-center justify-between shadow-[0_0_15px_rgba(16,185,129,0.25)]';
        bannerTitle.textContent = 'SAFE';
        bannerTitle.className = 'font-headline-lg font-bold text-secondary tracking-tight text-xl';
        if (bannerCode) {
          bannerCode.textContent = 'STATE A';
          bannerCode.className = 'px-1.5 py-0.5 rounded bg-secondary/20 font-label-sm text-[10px] text-secondary font-bold';
        }
        if (bannerSub) bannerSub.textContent = 'NORMAL OPERATION • LEVEL OPTIMAL';
        if (bannerIcon) bannerIcon.textContent = 'verified_user';
        if (bannerIconWrap) bannerIconWrap.className = 'w-10 h-10 rounded-xl bg-secondary-container/30 border border-secondary flex items-center justify-center text-secondary';
        if (ackBtn) ackBtn.classList.add('hidden');
      }
    }

    // 2. Water Tank Telemetry
    const levelPct = data.level ? (data.level.percent || 0) : 0;
    const waterBox = document.getElementById('water-fill-box');
    const waterPctEl = document.getElementById('water-pct-display');
    const waterCapEl = document.getElementById('water-capacity-metric');
    const waterElevEl = document.getElementById('water-elevation-label');

    if (waterBox) waterBox.style.height = `${Math.max(8, Math.min(100, levelPct))}%`;
    if (waterPctEl) waterPctEl.textContent = `${levelPct}%`;
    if (waterCapEl) waterCapEl.textContent = `${(levelPct * 25).toLocaleString()}`;
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
    if (flowIcon) flowIcon.className = isFlowConfirmed ? 'material-symbols-outlined text-secondary text-[14px]' : 'material-symbols-outlined text-outline text-[14px]';
    if (flowPill) flowPill.className = isFlowConfirmed ? 'flex-1 bg-secondary/15 border border-secondary/40 rounded-xl px-2 py-2 flex items-center justify-center space-x-1 shadow-[0_0_12px_rgba(78,222,163,0.15)]' : 'flex-1 bg-surface-container-high/40 border border-outline-variant/30 rounded-xl px-2 py-2 flex items-center justify-center space-x-1';

    // 5. Control Tab State
    const isAuto = data.mode === 'auto';
    const btnAuto = document.getElementById('btn-mode-auto');
    const btnManual = document.getElementById('btn-mode-manual');
    if (btnAuto && btnManual) {
      if (isAuto) {
        btnAuto.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary-container text-on-primary font-headline-md text-xs font-bold shadow-[0_0_16px_rgba(0,212,255,0.45)] transition-all';
        btnManual.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-on-surface-variant font-label-md text-xs hover:text-on-surface transition-all opacity-60';
      } else {
        btnManual.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-primary-container text-on-primary font-headline-md text-xs font-bold shadow-[0_0_16px_rgba(0,212,255,0.45)] transition-all';
        btnAuto.className = 'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-on-surface-variant font-label-md text-xs hover:text-on-surface transition-all opacity-60';
      }
    }

    // Tactical Arc Dial
    const dialArc = document.getElementById('svg-dial-arc');
    const dialAngleDisp = document.getElementById('dial-angle-display');
    const dialAngleSub = document.getElementById('dial-angle-sub');
    const dialAngleActual = document.getElementById('dial-angle-actual');
    const targetAngle = data.gate ? data.gate.target : 0;
    const actualAngle = data.gate ? data.gate.actual : 0;

    if (dialArc) {
      // 235.6 total dash array, 0 angle = offset 235.6, 100 angle = offset 78.5
      const offset = 235.6 - ((targetAngle / 100) * (235.6 - 78.5));
      dialArc.setAttribute('stroke-dashoffset', offset);
    }
    if (dialAngleDisp) dialAngleDisp.textContent = `${targetAngle.toFixed(1)}°`;
    if (dialAngleSub) {
      if (targetAngle === 0) dialAngleSub.textContent = 'CLOSED';
      else if (targetAngle >= 95) dialAngleSub.textContent = 'MAX FLOOD RELIEF';
      else if (targetAngle >= 50) dialAngleSub.textContent = 'HIGH DISCHARGE';
      else dialAngleSub.textContent = 'PARTIAL DRAFT';
    }
    if (dialAngleActual) dialAngleActual.textContent = `ACTUAL: ${actualAngle.toFixed(1)}°`;

    const sliderInput = document.getElementById('gate-range-input');
    const sliderLabel = document.getElementById('slider-val-label');
    if (sliderInput && document.activeElement !== sliderInput) sliderInput.value = targetAngle;
    if (sliderLabel) sliderLabel.textContent = `TARGET: ${targetAngle}°`;

    // Interlock state card
    const interlockCard = document.getElementById('proximity-hazard-card');
    const ctrlInterlockBadge = document.getElementById('ctrl-interlock-badge');
    if (data.interlocked) {
      if (interlockCard) interlockCard.classList.remove('hidden');
      if (ctrlInterlockBadge) {
        ctrlInterlockBadge.className = 'flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/20 border border-amber-500/50 text-amber-400 font-bold';
        ctrlInterlockBadge.innerHTML = '<span class="material-symbols-outlined text-[14px]">lock</span><span class="font-label-sm text-[10px]">INTERLOCKED</span>';
      }
    } else {
      if (interlockCard) interlockCard.classList.add('hidden');
      if (ctrlInterlockBadge) {
        ctrlInterlockBadge.className = 'flex items-center gap-1.5 px-2 py-1 rounded bg-secondary-container/10 border border-secondary/30 text-secondary';
        ctrlInterlockBadge.innerHTML = '<span class="material-symbols-outlined text-[14px]">lock_open</span><span class="font-label-sm text-[10px]">CLEAR</span>';
      }
    }

    // Pumps Controls
    if (data.pumps) {
      const p1 = data.pumps[0];
      const p2 = data.pumps[1];
      const btnP1On = document.getElementById('btn-pump1-on');
      const btnP1Off = document.getElementById('btn-pump1-off');
      const p1Badge = document.getElementById('pump1-status-badge');
      const p1Relay = document.getElementById('pump1-relay-state');
      const p1Speed = document.getElementById('pump1-speed-slider');
      const p1SpeedLbl = document.getElementById('pump1-speed-label');

      if (btnP1On && btnP1Off) {
        btnP1On.className = p1.on ? 'px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-sm text-xs font-bold shadow-[0_0_12px_rgba(78,222,163,0.5)]' : 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
        btnP1Off.className = !p1.on ? 'px-3 py-1.5 rounded-lg text-on-surface font-label-sm text-xs font-bold bg-surface-container-high border border-outline-variant/30' : 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      }
      if (p1Badge) p1Badge.textContent = p1.on ? 'ACTIVE / RUNNING' : 'STANDBY';
      if (p1Relay) p1Relay.textContent = p1.on ? 'RELAY ENGAGED' : 'RELAY DISENGAGED';
      if (p1Speed && document.activeElement !== p1Speed) p1Speed.value = p1.speed;
      if (p1SpeedLbl) p1SpeedLbl.textContent = `${p1.speed}%`;

      const btnP2On = document.getElementById('btn-pump2-on');
      const btnP2Off = document.getElementById('btn-pump2-off');
      const p2Badge = document.getElementById('pump2-status-badge');
      const p2Relay = document.getElementById('pump2-relay-state');
      const p2Speed = document.getElementById('pump2-speed-slider');
      const p2SpeedLbl = document.getElementById('pump2-speed-label');

      if (btnP2On && btnP2Off) {
        btnP2On.className = p2.on ? 'px-3 py-1.5 rounded-lg bg-secondary text-on-secondary font-label-sm text-xs font-bold shadow-[0_0_12px_rgba(78,222,163,0.5)]' : 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
        btnP2Off.className = !p2.on ? 'px-3 py-1.5 rounded-lg text-on-surface font-label-sm text-xs font-bold bg-surface-container-high border border-outline-variant/30' : 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      }
      if (p2Badge) p2Badge.textContent = p2.on ? 'ACTIVE / RUNNING' : 'STANDBY';
      if (p2Relay) p2Relay.textContent = p2.on ? 'RELAY ENGAGED' : 'RELAY DISENGAGED';
      if (p2Speed && document.activeElement !== p2Speed) p2Speed.value = p2.speed;
      if (p2SpeedLbl) p2SpeedLbl.textContent = `${p2.speed}%`;
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
      tHomeIcon.className = isTurbineOn ? 'material-symbols-outlined text-primary-container text-[22px] animate-spin' : 'material-symbols-outlined text-primary-container text-[22px]';
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
    if (tCtrlBadge) {
      tCtrlBadge.textContent = isTurbineOn ? `ONLINE • ${turbSpeed}%` : 'STANDBY';
      tCtrlBadge.className = isTurbineOn ?
        'px-2.5 py-1 rounded-full text-[10px] font-label-sm font-bold bg-primary-container/20 text-primary-container border border-primary-container/40 shadow-[0_0_8px_#00d4ff]' :
        'px-2.5 py-1 rounded-full text-[10px] font-label-sm font-bold bg-surface-container text-on-surface-variant border border-outline-variant/40';
    }
    if (tCtrlIcon) {
      tCtrlIcon.className = isTurbineOn ? 'material-symbols-outlined text-[18px] animate-spin' : 'material-symbols-outlined text-[18px]';
    }
    if (tRelayState) {
      tRelayState.textContent = isTurbineOn ? `GENERATING • ${turbSpeed}% PWM` : 'RELAY IDLE';
      tRelayState.className = isTurbineOn ? 'font-label-md text-xs font-bold flex items-center gap-1.5 text-primary-container' : 'font-label-md text-xs font-bold flex items-center gap-1.5 text-on-surface-variant';
    }
    if (btnTurbOff && btnTurbOn) {
      if (isTurbineOn) {
        btnTurbOn.className = 'px-3 py-1.5 rounded-lg font-label-sm text-xs font-bold bg-primary-container text-surface-container-lowest shadow-[0_0_8px_#00d4ff]';
        btnTurbOff.className = 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      } else {
        btnTurbOff.className = 'px-3 py-1.5 rounded-lg text-on-surface font-label-sm text-xs font-bold bg-surface-container-high border border-outline-variant/30';
        btnTurbOn.className = 'px-3 py-1.5 rounded-lg text-on-surface-variant text-xs font-label-sm font-semibold opacity-60';
      }
    }
    if (tSpeedLabel) tSpeedLabel.textContent = `${turbSpeed}%`;
    if (tSpeedSlider && document.activeElement !== tSpeedSlider) tSpeedSlider.value = turbSpeed;

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
  },

  startWatchdog() {
    setInterval(() => {
      if (this.isOffline) {
        fetch('/api/state')
          .then(res => res.json())
          .then(d => this.handleStateUpdate(d))
          .catch(() => {});
      }
    }, 2500);
  }
};

/**
 * REST / WebSocket API Client
 */
const api = {
  send(endpoint, body) {
    if (app.ws && app.ws.readyState === WebSocket.OPEN) {
      app.ws.send(JSON.stringify({ cmd: endpoint.replace('/api/', ''), ...body }));
      return Promise.resolve({ ok: true });
    }
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(r => r.json()).catch(e => console.warn(e));
  },

  setGate(angle) {
    return this.send('/api/gate', { angle: parseInt(angle, 10) });
  },

  setPump(id, on, speed) {
    return this.send('/api/pump', { id, on, speed: parseInt(speed, 10) });
  },

  setTurbine(on, speed) {
    return this.send('/api/turbine', { on: !!on, speed: parseInt(speed, 10) });
  },

  setMode(mode) {
    return this.send('/api/mode', { mode });
  },

  override(confirm) {
    return this.send('/api/override', { confirm: !!confirm });
  },

  ack() {
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

/**
 * UI Event Handlers and Navigation
 */
const ui = {
  switchTab(tabId) {
    app.activeTab = tabId;
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.className = 'flex flex-col items-center justify-center text-on-surface-variant opacity-70 hover:text-primary hover:opacity-100 transition-all duration-150 active:scale-90 min-h-[48px] px-2 nav-btn';
      const ind = btn.querySelector('.nav-indicator');
      if (ind) ind.className = 'w-4 h-0.5 bg-transparent rounded-full mt-0.5 nav-indicator';
    });

    const activePanel = document.getElementById(`tab-${tabId}`);
    const activeBtn = document.getElementById(`nav-btn-${tabId}`);
    if (activePanel) activePanel.classList.add('active');
    if (activeBtn) {
      activeBtn.className = 'flex flex-col items-center justify-center text-primary-container drop-shadow-[0_0_8px_rgba(0,212,255,0.4)] active:scale-90 transition-transform duration-100 min-h-[48px] px-2 nav-btn';
      const ind = activeBtn.querySelector('.nav-indicator');
      if (ind) ind.className = 'w-4 h-0.5 bg-primary-container rounded-full mt-0.5 shadow-[0_0_6px_#00d4ff] nav-indicator';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  setGateQuick(deg) {
    api.setGate(deg);
    const range = document.getElementById('gate-range-input');
    const lbl = document.getElementById('slider-val-label');
    if (range) range.value = deg;
    if (lbl) lbl.textContent = `TARGET: ${deg}°`;
  },

  onGateSlider(deg) {
    const lbl = document.getElementById('slider-val-label');
    if (lbl) lbl.textContent = `TARGET: ${deg}°`;
    if (this._gateDebounce) clearTimeout(this._gateDebounce);
    this._gateDebounce = setTimeout(() => {
      api.setGate(deg);
    }, 120);
  },

  onPumpToggle(id, on) {
    const slider = document.getElementById(`pump${id}-speed-slider`);
    const speed = slider ? slider.value : 100;
    api.setPump(id, on, speed);
  },

  onPumpSpeed(id, val) {
    const lbl = document.getElementById(`pump${id}-speed-label`);
    if (lbl) lbl.textContent = `${val}%`;
    const btnOn = document.getElementById(`btn-pump${id}-on`);
    const isCurrentlyOn = btnOn && btnOn.classList.contains('bg-secondary');
    if (this[`_pDebounce${id}`]) clearTimeout(this[`_pDebounce${id}`]);
    this[`_pDebounce${id}`] = setTimeout(() => {
      api.setPump(id, isCurrentlyOn, val);
    }, 180);
  },

  onTurbineToggle(on) {
    const slider = document.getElementById('turbine-speed-slider');
    const speed = on ? (slider && parseInt(slider.value, 10) > 0 ? parseInt(slider.value, 10) : 80) : 0;
    api.setTurbine(on, speed);
  },

  onTurbineSpeed(val) {
    const lbl = document.getElementById('turbine-speed-label');
    if (lbl) lbl.textContent = `${val}%`;
    if (this._tDebounce) clearTimeout(this._tDebounce);
    this._tDebounce = setTimeout(() => {
      const on = parseInt(val, 10) > 0;
      api.setTurbine(on, parseInt(val, 10));
    }, 150);
  },

  setTurbinePreset(pct) {
    const slider = document.getElementById('turbine-speed-slider');
    if (slider) slider.value = pct;
    this.onTurbineSpeed(pct);
  },

  onTurbineQuickToggle() {
    const isRunning = app.state && app.state.turbine && app.state.turbine.on;
    this.onTurbineToggle(!isRunning);
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
      alert('Threshold parameters updated on telemetry bus.');
    });
  }
};

window.app = app;
window.api = api;
window.ui = ui;

document.addEventListener('DOMContentLoaded', () => {
  app.init();
  api.fetchLog();
});
