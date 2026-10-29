/**
 * AquaGuard — Settings & Live Wiring Test View (settings.js)
 * Live pin diagnostics, hardware calibration, and configuration
 */
'use strict';

const settingsView = {
  update(data) {
    // 1. Live Wiring Test grid
    const wires = data.level ? (data.level.wires || {}) : {};
    const wireKeys = [
      { key: 'low', id: 'wt-low' },
      { key: 'medium', id: 'wt-medium' },
      { key: 'high', id: 'wt-high' },
      { key: 'warning', id: 'wt-warning' },
      { key: 'flow', id: 'wt-flow' }
    ];

    wireKeys.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) {
        const isWet = !!wires[item.key];
        const dot = el.querySelector('.wt-dot');
        const stateText = el.querySelector('.wt-state');
        if (dot) dot.style.background = isWet ? '#00D4FF' : '#334155';
        if (stateText) {
          stateText.textContent = isWet ? 'WET' : 'DRY';
          stateText.style.color = isWet ? '#00D4FF' : '#64748B';
        }
      }
    });

    // 2. Extra live diagnostics
    const wtUltra = document.getElementById('wt-ultra');
    const wtFlame = document.getElementById('wt-flame');
    const wtGas = document.getElementById('wt-gas');

    if (wtUltra && data.proximity) {
      wtUltra.textContent = data.proximity.distanceCm >= 0 ? `${data.proximity.distanceCm.toFixed(1)} cm` : 'Out of range';
    }
    if (wtFlame) {
      wtFlame.textContent = data.fire ? 'FLAME ACTIVE (LOW)' : 'IDLE (HIGH)';
      wtFlame.style.color = data.fire ? '#EF4444' : '#10B981';
    }
    if (wtGas && data.gas) {
      wtGas.textContent = `${data.gas.raw || 0} ADC (${data.gas.level || 'WARMUP'})`;
    }

    // 3. Firmware info
    const aboutFw = document.getElementById('about-fw');
    const aboutBuild = document.getElementById('about-build');
    if (aboutFw && data.fwVersion) aboutFw.textContent = `v${data.fwVersion}`;
    if (aboutBuild) aboutBuild.textContent = 'ESP32 LittleFS Release';
  }
};

window.settingsView = settingsView;
