/**
 * AquaGuard — Sensors Tab View (sensors.js)
 * MQ-135 analog gauge canvas, HC-SR04 radar sweep, flame status, and water level wires
 */
'use strict';

const sensorsView = {
  gasCanvas: null,
  gasCtx: null,
  radarCanvas: null,
  radarCtx: null,
  radarAngle: 0,
  radarAnimId: null,

  init() {
    this.gasCanvas = document.getElementById('gas-gauge-canvas');
    if (this.gasCanvas) this.gasCtx = this.gasCanvas.getContext('2d');

    this.radarCanvas = document.getElementById('radar-canvas');
    if (this.radarCanvas) {
      this.radarCtx = this.radarCanvas.getContext('2d');
      this.startRadarAnimation();
    }
  },

  drawGasGauge(rawVal, level, warmupSecs) {
    if (!this.gasCtx || !this.gasCanvas) return;
    const ctx = this.gasCtx;
    const w = this.gasCanvas.width;
    const h = this.gasCanvas.height;
    const cx = w / 2;
    const cy = h - 18;
    const radius = 95;

    ctx.clearRect(0, 0, w, h);

    // 1. Arc track background
    const startAngle = Math.PI;
    const endAngle = 2 * Math.PI;

    // Normal zone (0 - 1500 ADC) -> 0 to 36.6% of arc
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + Math.PI * 0.366);
    ctx.strokeStyle = '#10B981';
    ctx.stroke();

    // Warning zone (1500 - 2800 ADC) -> 36.6% to 68.3%
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle + Math.PI * 0.366, startAngle + Math.PI * 0.683);
    ctx.strokeStyle = '#F59E0B';
    ctx.stroke();

    // Danger zone (2800 - 4095 ADC) -> 68.3% to 100%
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle + Math.PI * 0.683, endAngle);
    ctx.strokeStyle = '#EF4444';
    ctx.stroke();

    // 2. Needle
    const clampedRaw = Math.max(0, Math.min(4095, rawVal || 0));
    const needleRatio = clampedRaw / 4095;
    const needleAngle = startAngle + (Math.PI * needleRatio);

    const nx = cx + Math.cos(needleAngle) * (radius - 12);
    const ny = cy + Math.sin(needleAngle) * (radius - 12);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center pivot
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#00D4FF';
    ctx.fill();

    // Labels
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#859398';
    ctx.textAlign = 'center';
    ctx.fillText('0', cx - radius + 8, cy + 12);
    ctx.fillText('4095', cx + radius - 8, cy + 12);
  },

  startRadarAnimation() {
    const render = () => {
      this.drawRadar();
      this.radarAngle += 0.04;
      if (this.radarAngle >= Math.PI) this.radarAngle = 0;
      this.radarAnimId = requestAnimationFrame(render);
    };
    render();
  },

  drawRadar() {
    if (!this.radarCtx || !this.radarCanvas) return;
    const ctx = this.radarCtx;
    const w = this.radarCanvas.width;
    const h = this.radarCanvas.height;
    const cx = w / 2;
    const cy = h - 14;
    const maxRadius = 100;

    ctx.clearRect(0, 0, w, h);

    // Concentric range arcs (40cm, 20cm, 10cm)
    [0.3, 0.6, 1.0].forEach(rPct => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius * rPct, Math.PI, 2 * Math.PI);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.18)';
      ctx.stroke();
    });

    // Radial guidelines
    [-Math.PI / 4, 0, Math.PI / 4].forEach(offset => {
      const angle = (1.5 * Math.PI) + offset;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxRadius, cy + Math.sin(angle) * maxRadius);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)';
      ctx.stroke();
    });

    // Rotating Radar Sweep Beam
    const sweepAngle = Math.PI + this.radarAngle;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxRadius, sweepAngle - 0.25, sweepAngle);
    ctx.closePath();
    const sweepGrad = ctx.createRadialGradient(cx, cy, 10, cx, cy, maxRadius);
    sweepGrad.addColorStop(0, 'rgba(0, 212, 255, 0.4)');
    sweepGrad.addColorStop(1, 'rgba(0, 212, 255, 0.0)');
    ctx.fillStyle = sweepGrad;
    ctx.fill();
    ctx.restore();

    // Draw detected object blip
    const prox = app.state ? (app.state.proximity || {}) : {};
    const dist = prox.distanceCm;
    if (dist && dist > 0 && dist <= 60) {
      const normDist = Math.min(1.0, dist / 60);
      const blipRadius = maxRadius * normDist;
      // Position blip roughly center-forward
      const blipAngle = 1.5 * Math.PI; 
      const bx = cx + Math.cos(blipAngle) * blipRadius;
      const by = cy + Math.sin(blipAngle) * blipRadius;

      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fillStyle = dist < 15 ? '#EF4444' : (dist < 40 ? '#F59E0B' : '#00D4FF');
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  },

  update(data) {
    if (!this.gasCanvas) this.init();

    // 1. Gas (MQ-135)
    const gas = data.gas || {};
    const gasBadge = document.getElementById('gas-badge');
    const gasRaw = document.getElementById('gas-raw');
    const gasWarmupMsg = document.getElementById('gas-warmup-msg');

    if (gasRaw) gasRaw.textContent = gas.raw !== undefined ? gas.raw : '----';
    if (gasBadge) {
      const lvl = gas.level || 'WARMUP';
      gasBadge.textContent = lvl;
      gasBadge.className = `gas-badge ${lvl.toLowerCase()}`;
    }

    if (gasWarmupMsg) {
      if (gas.warmupS > 0) {
        gasWarmupMsg.textContent = `Warming up SnO2 sensor: ${gas.warmupS}s left`;
      } else {
        gasWarmupMsg.textContent = 'Operational (Clean Air / Target Gases)';
      }
    }
    this.drawGasGauge(gas.raw, gas.level, gas.warmupS);

    // 2. Flame
    const flameBadge = document.getElementById('flame-badge');
    const flameText = document.getElementById('flame-status-text');
    const flameIcon = document.getElementById('flame-icon');
    const flameDetected = !!data.fire;

    if (flameBadge) {
      flameBadge.textContent = flameDetected ? 'FLAME ALERT' : 'NO FLAME';
      flameBadge.className = flameDetected ? 'flame-badge critical' : 'flame-badge safe';
    }
    if (flameText) flameText.textContent = flameDetected ? 'Active Flame Detected!' : 'No Flame Detected';
    if (flameIcon) {
      flameIcon.style.transform = flameDetected ? 'scale(1.3)' : 'scale(1)';
      flameIcon.style.filter = flameDetected ? 'drop-shadow(0 0 16px #EF4444)' : 'none';
    }

    // 3. Proximity (HC-SR04)
    const prox = data.proximity || {};
    const zoneBadge = document.getElementById('zone-badge');
    const proxDist = document.getElementById('prox-dist-value');
    if (zoneBadge) {
      const z = prox.zone || 'CLEAR';
      zoneBadge.textContent = z;
      zoneBadge.className = `zone-badge ${z.toLowerCase()}`;
    }
    if (proxDist) {
      proxDist.textContent = prox.distanceCm >= 0 ? `${prox.distanceCm.toFixed(1)} cm` : 'Out of range';
    }

    // 4. Water Level Wires
    const wires = data.level ? (data.level.wires || {}) : {};
    const wireKeys = ['low', 'medium', 'high', 'warning', 'flow'];
    wireKeys.forEach(k => {
      const el = document.getElementById(`wire-${k}`);
      if (el) {
        const isWet = !!wires[k];
        const dot = el.querySelector('.wire-dot');
        const stateText = el.querySelector('.wire-state');
        if (dot) dot.style.background = isWet ? '#00D4FF' : '#475569';
        if (stateText) {
          stateText.textContent = isWet ? 'WET' : 'DRY';
          stateText.style.color = isWet ? '#00D4FF' : '#64748B';
        }
      }
    });

    const probeBadge = document.getElementById('probe-badge');
    if (probeBadge) {
      const fault = data.level ? !!data.level.probeFault : false;
      probeBadge.textContent = fault ? 'FAULT' : 'OK';
      probeBadge.className = fault ? 'probe-badge critical' : 'probe-badge safe';
    }

    // 5. System Health
    const uptimeEl = document.getElementById('sys-uptime');
    const heapEl = document.getElementById('sys-heap');
    const clientsEl = document.getElementById('sys-clients');
    const fwEl = document.getElementById('sys-fw');

    if (uptimeEl && data.uptime !== undefined) {
      const hrs = Math.floor(data.uptime / 3600);
      const mins = Math.floor((data.uptime % 3600) / 60);
      const secs = data.uptime % 60;
      uptimeEl.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    }
    if (heapEl && data.freeHeap !== undefined) {
      heapEl.textContent = `${Math.round(data.freeHeap / 1024)} KB`;
    }
    if (clientsEl && data.wsClients !== undefined) {
      clientsEl.textContent = String(data.wsClients);
    }
    if (fwEl && data.fwVersion) {
      fwEl.textContent = data.fwVersion;
    }
  }
};

window.sensorsView = sensorsView;
