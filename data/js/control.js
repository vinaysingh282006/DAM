/**
 * AquaGuard — Control Tab View (control.js)
 * Circular arc dial for gate angle, quick buttons, mode switch, and pump controls
 */
'use strict';

const controlView = {
  dialCanvas: null,
  dialCtx: null,
  isDragging: false,
  currentAngle: 0,
  targetAngle: 0,

  init() {
    this.dialCanvas = document.getElementById('gate-dial-canvas');
    if (this.dialCanvas) {
      this.dialCtx = this.dialCanvas.getContext('2d');
      this.attachDialEvents();
      this.drawDial(0);
    }
  },

  attachDialEvents() {
    const canvas = this.dialCanvas;
    if (!canvas) return;

    const handleMove = (e) => {
      if (!this.isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;

      // Calculate angle from 6 o'clock or left arc:
      // We map the arc from 135 deg to 405 deg (270 deg sweep)
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      // Normalize to 0-360
      if (angle < 0) angle += 360;

      // Arc start is at 135 deg, arc end is at 45 deg (via 0) = 270 total sweep
      let relative = angle - 135;
      if (relative < 0) relative += 360;

      if (relative <= 270) {
        let val = Math.round((relative / 270) * 100);
        val = Math.max(0, Math.min(100, val));
        this.setDialAngle(val, true);
      }
    };

    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      handleMove(e);
    });
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        api.setGate(this.targetAngle);
      }
    });

    // Touch events for mobile
    canvas.addEventListener('touchstart', (e) => {
      this.isDragging = true;
      handleMove(e);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (this.isDragging) handleMove(e);
    }, { passive: true });
    window.addEventListener('touchend', () => {
      if (this.isDragging) {
        this.isDragging = false;
        api.setGate(this.targetAngle);
      }
    });
  },

  setDialAngle(angle, userInitiated = false) {
    this.targetAngle = angle;
    this.drawDial(angle);

    const valEl = document.getElementById('gate-dial-value');
    const subEl = document.getElementById('gate-dial-sub');
    const badge = document.getElementById('ctrl-gate-badge');
    const slider = document.getElementById('gate-slider');
    const sliderDisp = document.getElementById('gate-slider-display');

    if (valEl) valEl.textContent = `${angle}°`;
    if (badge) badge.textContent = `${angle}°`;
    if (slider) slider.value = angle;
    if (sliderDisp) sliderDisp.textContent = `${angle}°`;

    if (subEl) {
      if (angle === 0) subEl.textContent = 'CLOSED';
      else if (angle >= 90) subEl.textContent = 'EMERGENCY FULL';
      else if (angle >= 40) subEl.textContent = 'HIGH DISCHARGE';
      else subEl.textContent = 'PARTIAL FLOW';
    }
  },

  drawDial(angle) {
    if (!this.dialCtx || !this.dialCanvas) return;
    const ctx = this.dialCtx;
    const w = this.dialCanvas.width;
    const h = this.dialCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = 75;

    ctx.clearRect(0, 0, w, h);

    const startRad = (135 * Math.PI) / 180;
    const totalSweep = (270 * Math.PI) / 180;
    const endRad = startRad + totalSweep;

    // 1. Background Track
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startRad, endRad, false);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#1E293B';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 2. Active Arc
    const pct = Math.max(0, Math.min(100, angle)) / 100;
    const activeSweep = totalSweep * pct;

    if (activeSweep > 0.01) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startRad, startRad + activeSweep, false);
      ctx.lineWidth = 14;
      const grad = ctx.createLinearGradient(0, cy, w, cy);
      grad.addColorStop(0, '#00D4FF');
      grad.addColorStop(0.7, '#0284C7');
      grad.addColorStop(1, angle > 80 ? '#EF4444' : '#00F2FE');
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 3. Pointer Knob
    const knobAngle = startRad + activeSweep;
    const kx = cx + Math.cos(knobAngle) * radius;
    const ky = cy + Math.sin(knobAngle) * radius;

    ctx.beginPath();
    ctx.arc(kx, ky, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#00D4FF';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0; // reset
  },

  update(data) {
    if (!this.dialCanvas) this.init();

    // Mode Toggle
    const modeAuto = document.getElementById('mode-auto-btn');
    const modeManual = document.getElementById('mode-manual-btn');
    const isAuto = data.mode === 'auto';
    if (modeAuto && modeManual) {
      modeAuto.classList.toggle('active', isAuto);
      modeManual.classList.toggle('active', !isAuto);
      modeAuto.setAttribute('aria-pressed', isAuto);
      modeManual.setAttribute('aria-pressed', !isAuto);
    }

    // Gate Angle (only update dial if user is not actively dragging it)
    if (!this.isDragging && data.gate) {
      const angle = data.gate.target !== undefined ? data.gate.target : 0;
      this.setDialAngle(angle, false);
    }

    // Proximity Interlock state
    const interlock = document.getElementById('interlock-warn');
    if (interlock) {
      if (data.interlocked) {
        interlock.classList.remove('hidden');
      } else {
        interlock.classList.add('hidden');
      }
    }

    // Pumps
    if (data.pumps) {
      data.pumps.forEach(p => {
        const id = p.id;
        const toggle = document.getElementById(`pump${id}-toggle`);
        const speed = document.getElementById(`pump${id}-speed`);
        const speedDisp = document.getElementById(`pump${id}-speed-display`);
        const runtime = document.getElementById(`pump${id}-runtime`);
        const dryWarn = document.getElementById(`pump${id}-dry-warn`);

        if (toggle && document.activeElement !== toggle) toggle.checked = !!p.on;
        if (speed && document.activeElement !== speed) speed.value = p.speed || 100;
        if (speedDisp) speedDisp.textContent = `${p.speed || 100}%`;

        if (runtime && p.runtimeS !== undefined) {
          const hrs = Math.floor(p.runtimeS / 3600);
          const mins = Math.floor((p.runtimeS % 3600) / 60);
          const secs = p.runtimeS % 60;
          runtime.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        }
        if (dryWarn) {
          dryWarn.classList.toggle('hidden', !p.dryWarning);
        }
      });
    }
  }
};

window.controlView = controlView;
