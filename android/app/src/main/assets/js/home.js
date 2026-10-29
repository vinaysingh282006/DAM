/**
 * AquaGuard — Home Tab View (home.js)
 * Water tank canvas wave simulation, gate SVG motion, flow ripple, and event logs
 */
'use strict';

const homeView = {
  canvas: null,
  ctx: null,
  wavePhase: 0,
  targetLevel: 0,
  currentLevel: 0,
  animId: null,

  init() {
    this.canvas = document.getElementById('tank-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
      this.startWaveAnimation();
    }
  },

  startWaveAnimation() {
    const render = () => {
      this.drawTank();
      this.wavePhase += 0.04;
      // Smoothly interpolate level
      this.currentLevel += (this.targetLevel - this.currentLevel) * 0.08;
      this.animId = requestAnimationFrame(render);
    };
    render();
  },

  drawTank() {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Tank outline / glass container background
    ctx.save();
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 12);
    ctx.fill();
    ctx.stroke();
    ctx.clip(); // Keep water within rounded corners

    // Water level height calculation
    const fillPct = Math.max(0, Math.min(100, this.currentLevel)) / 100;
    const waterHeight = (h - 30) * fillPct;
    const waterY = (h - 15) - waterHeight;

    if (fillPct > 0.01) {
      // Pick water color based on alarms
      let gradStart = '#00D4FF';
      let gradEnd = '#0072FF';
      const status = app.state ? (app.state.status || 'SAFE') : 'SAFE';

      if (fillPct >= 0.95 || status === 'CRITICAL') {
        gradStart = '#EF4444';
        gradEnd = '#991B1B';
      } else if (fillPct >= 0.70 || status === 'WARNING') {
        gradStart = '#F59E0B';
        gradEnd = '#B45309';
      }

      const grad = ctx.createLinearGradient(0, waterY, 0, h);
      grad.addColorStop(0, gradStart);
      grad.addColorStop(1, gradEnd);

      // Draw animated wave surface
      ctx.beginPath();
      ctx.moveTo(10, h);
      ctx.lineTo(10, waterY);

      for (let x = 10; x <= w - 10; x += 5) {
        const wave = Math.sin((x / 30) + this.wavePhase) * (fillPct > 0.98 ? 1.5 : 4.5);
        ctx.lineTo(x, waterY + wave);
      }

      ctx.lineTo(w - 10, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Top wave highlight foam
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.restore();
  },

  update(data) {
    if (!this.canvas) this.init();

    // 1. Water Level
    const levelPct = data.level ? (data.level.percent || 0) : 0;
    this.targetLevel = levelPct;

    const badge = document.getElementById('tank-level-badge');
    const overlay = document.getElementById('tank-percent');
    if (badge) badge.textContent = `${levelPct}%`;
    if (overlay) overlay.textContent = `${levelPct}%`;

    // 2. Gate SVG graphic
    const gateAngle = data.gate ? (data.gate.actual !== undefined ? data.gate.actual : data.gate.target) : 0;
    const gateBadge = document.getElementById('gate-angle-badge');
    if (gateBadge) gateBadge.textContent = `${gateAngle}°`;

    const doorGroup = document.getElementById('gate-door-group');
    if (doorGroup) {
      // Rotate the SVG gate door based on angle (0 - 100 deg)
      // Visual rotation maps 0-100 deg to -50 deg upward tilt
      const rot = (gateAngle / 100) * -55;
      doorGroup.setAttribute('transform', `rotate(${rot} 55 35)`);
    }

    const flowArrows = document.getElementById('flow-arrows');
    const flowStatus = document.getElementById('gate-flow-status');
    const flowText = document.getElementById('flow-state-text');
    const flowDot = document.getElementById('flow-dot');

    const flowState = data.flow ? data.flow.state : 'CLOSED';
    if (flowText) flowText.textContent = flowState.replace('_', ' ');

    if (flowState === 'FLOW_CONFIRMED') {
      if (flowArrows) {
        flowArrows.setAttribute('opacity', '1');
        flowArrows.classList.add('flow-animating');
      }
      if (flowDot) flowDot.style.background = '#00D4FF';
    } else if (flowState === 'LEAK_WARNING') {
      if (flowArrows) flowArrows.setAttribute('opacity', '0.5');
      if (flowDot) flowDot.style.background = '#EF4444';
    } else {
      if (flowArrows) {
        flowArrows.setAttribute('opacity', '0');
        flowArrows.classList.remove('flow-animating');
      }
      if (flowDot) flowDot.style.background = '#6B7280';
    }

    // 3. Quick Status Row
    if (data.pumps && data.pumps.length >= 2) {
      const p1 = data.pumps[0];
      const p2 = data.pumps[1];
      const p1Pill = document.getElementById('pump1-quick');
      const p2Pill = document.getElementById('pump2-quick');
      if (p1Pill) {
        p1Pill.innerHTML = `<span class="pill-dot" style="background:${p1.on ? '#10B981':'#6B7280'}"></span>Pump 1: <strong>${p1.on ? p1.speed + '%' : 'OFF'}</strong>`;
      }
      if (p2Pill) {
        p2Pill.innerHTML = `<span class="pill-dot" style="background:${p2.on ? '#10B981':'#6B7280'}"></span>Pump 2: <strong>${p2.on ? p2.speed + '%' : 'OFF'}</strong>`;
      }
    }
    const flowQuick = document.getElementById('flow-quick');
    if (flowQuick) {
      const isWet = flowState === 'FLOW_CONFIRMED';
      flowQuick.innerHTML = `<span class="pill-dot" style="background:${isWet ? '#00D4FF':'#6B7280'}"></span>Flow: <strong>${flowState}</strong>`;
    }

    // 4. Proximity Banner
    const proxBanner = document.getElementById('prox-banner');
    const proxDistBadge = document.getElementById('prox-dist-badge');
    const prox = data.proximity || {};
    if (prox.zone === 'DANGER' || prox.zone === 'WARNING') {
      if (proxBanner) proxBanner.classList.remove('hidden');
      if (proxDistBadge) proxDistBadge.textContent = `${prox.distanceCm >= 0 ? prox.distanceCm.toFixed(1) : '--'} cm`;
    } else {
      if (proxBanner) proxBanner.classList.add('hidden');
    }

    // 5. Flow Confirmation Card
    const flowCard = document.getElementById('flow-card');
    const flowStateBadge = document.getElementById('flow-state-badge');
    const flowMessage = document.getElementById('flow-message');
    const ripple = document.getElementById('flow-ripple');

    if (flowStateBadge) flowStateBadge.textContent = flowState;
    if (flowCard) flowCard.classList.remove('hidden');

    if (flowState === 'FLOW_CONFIRMED') {
      if (flowMessage) flowMessage.textContent = 'Spillway active — tailrace water flow confirmed';
      if (ripple) ripple.classList.remove('hidden');
    } else if (flowState === 'FLOW_FAULT') {
      if (flowMessage) flowMessage.textContent = 'FAULT: Gate opened but no tailrace water detected!';
      if (ripple) ripple.classList.add('hidden');
    } else if (flowState === 'LEAK_WARNING') {
      if (flowMessage) flowMessage.textContent = 'LEAK ALERT: Tailrace wire wet while gate is closed!';
      if (ripple) ripple.classList.add('hidden');
    } else {
      if (flowMessage) flowMessage.textContent = 'Gate closed — no discharge flow';
      if (ripple) ripple.classList.add('hidden');
    }
  },

  renderLog(events) {
    const list = document.getElementById('log-list');
    if (!list) return;
    if (!events || events.length === 0) {
      list.innerHTML = '<p class="log-empty">No events recorded</p>';
      return;
    }
    list.innerHTML = events.slice(-20).reverse().map(e => {
      const timeStr = typeof e.ts === 'number' ? new Date(e.ts * 1000).toLocaleTimeString() : '--:--:--';
      const color = e.level === 3 ? '#EF4444' : (e.level === 2 ? '#F59E0B' : '#00D4FF');
      return `<div class="log-item" style="border-left: 3px solid ${color}; padding: 6px 10px; margin-bottom: 6px; background: rgba(255,255,255,0.02); border-radius: 4px;">
        <span class="mono" style="font-size:0.75rem; color:#859398; margin-right:8px;">[${timeStr}]</span>
        <span style="font-size:0.85rem; color:#E2E8F0;">${e.msg}</span>
      </div>`;
    }).join('');
  }
};

window.homeView = homeView;
