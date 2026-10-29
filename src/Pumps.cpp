/**
 * @file Pumps.cpp
 * @brief AquaGuard — Pump controller implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "Pumps.h"
#include "Logger.h"

// Pin table: [0] = pump1 (GPIO 16), [1] = pump2 (GPIO 17)
static const uint8_t kPIN[]  = { PIN_PUMP1, PIN_PUMP2 };
static const uint8_t kCH[]   = { PUMP_LEDC_CH1, PUMP_LEDC_CH2 };

// ──────────────────────────────────────────────────────────
void Pumps::begin() {
    for (int i = 0; i < 2; i++) {
        pinMode(kPIN[i], OUTPUT);
        digitalWrite(kPIN[i], LOW);

#ifndef NATIVE_UNIT_TEST
        ledcSetup(kCH[i], PUMP_PWM_FREQ_HZ, PUMP_PWM_BITS);
        ledcAttachPin(kPIN[i], kCH[i]);
        ledcWrite(kCH[i], 0);
#endif
        _pump[i] = {};
    }
    Logger::log(LogLevel::INFO, "Pumps: initialised (MJE3055T on GPIO 16 & 17)");
}

// ──────────────────────────────────────────────────────────
void Pumps::setChannel(int id, bool on, int speedPct, bool reverse) {
    (void)reverse; // Single-direction MJE3055T transistor switch
    if (id < 1 || id > 2) return;
    int idx = id - 1;

    _autoStopped = false; // Clear auto-stopped lock on manual operator command
    if (on && speedPct <= 0) speedPct = 100; // Default to 100% when commanded ON
    speedPct = constrain(speedPct, 0, 100);

    _pump[idx].on       = on;
    _pump[idx].speedPct = static_cast<uint8_t>(speedPct);
    _pump[idx].dryWarning = false;

    if (on) {
#ifndef NATIVE_UNIT_TEST
        _pump[idx].startedAt = millis();
#endif
    } else {
        _pump[idx].startedAt = 0;
    }

    _applyPump(idx);

    char buf[60];
    snprintf(buf, sizeof(buf), "Pump %d: %s at %d%% (MJE3055T)",
             id, on ? "ON" : "OFF", speedPct);
    Logger::log(LogLevel::INFO, buf);
}

// ──────────────────────────────────────────────────────────
void Pumps::autoStop() {
    if (!_autoStopped) {
        for (int i = 0; i < 2; i++) {
            _pump[i].on       = false;
            _pump[i].speedPct = 0;
            _applyPump(i);
        }
        _autoStopped = true;
        Logger::log(LogLevel::WARNING,
            "AUTO: both pumps stopped — DAM WARNING active");
    }
}

// ──────────────────────────────────────────────────────────
void Pumps::update(unsigned long now, bool lowWireWet) {
    for (int i = 0; i < 2; i++) {
        if (!_pump[i].on || _pump[i].startedAt == 0) continue;

        unsigned long runtime = now - _pump[i].startedAt;
        if (!lowWireWet && runtime >= PUMP_DRY_WARN_MS && !_pump[i].dryWarning) {
            _pump[i].dryWarning = true;
            char buf[80];
            snprintf(buf, sizeof(buf),
                "WARNING: pump %d running for %lus, water low — source may be empty",
                i + 1, runtime / 1000);
            Logger::log(LogLevel::WARNING, buf);
        }
    }
}

// ──────────────────────────────────────────────────────────
void Pumps::_applyPump(int idx) {
    if (_pump[idx].on) {
        uint32_t duty = (_pump[idx].speedPct * 255UL) / 100UL;
#ifndef NATIVE_UNIT_TEST
        ledcWrite(kCH[idx], duty);
#endif
    } else {
#ifndef NATIVE_UNIT_TEST
        ledcWrite(kCH[idx], 0);
#endif
        digitalWrite(kPIN[idx], LOW);
    }
}
