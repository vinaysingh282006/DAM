/**
 * AquaGuard — Water Level History Chart (chart.js)
 * Clean, lightweight canvas time-series renderer
 */
'use strict';

const chartView = {
  canvas: null,
  ctx: null,

  init() {
    this.canvas = document.getElementById('history-canvas');
    if (this.canvas) {
      this.ctx = this.canvas.getContext('2d');
    }
  },

  update(historyPoints) {
    if (!this.canvas) this.init();
    if (!this.ctx || !this.canvas) return;
    if (!historyPoints || historyPoints.length < 2) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const padX = 24;
    const padY = 16;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    ctx.clearRect(0, 0, w, h);

    // 1. Grid Lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach(level => {
      const y = h - padY - (level / 100) * plotH;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(w - padX, y);
      ctx.stroke();

      ctx.fillStyle = '#64748B';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${level}%`, padX - 4, y + 3);
    });

    // 2. Plot Points
    const stepX = plotW / (historyPoints.length - 1);
    ctx.beginPath();

    historyPoints.forEach((val, idx) => {
      const x = padX + idx * stepX;
      const pct = Math.max(0, Math.min(100, typeof val === 'number' ? val : (val.level || 0)));
      const y = h - padY - (pct / 100) * plotH;

      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // Stroke line
    ctx.strokeStyle = '#00D4FF';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(0, 212, 255, 0.6)';
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Fill area under line
    ctx.lineTo(padX + (historyPoints.length - 1) * stepX, h - padY);
    ctx.lineTo(padX, h - padY);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(0, padY, 0, h - padY);
    fillGrad.addColorStop(0, 'rgba(0, 212, 255, 0.25)');
    fillGrad.addColorStop(1, 'rgba(0, 212, 255, 0.0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();
  }
};

window.chartView = chartView;
