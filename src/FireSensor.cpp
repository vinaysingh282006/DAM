/**
 * @file FireSensor.cpp
 * @brief AquaGuard — Flame sensor implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "FireSensor.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
void FireSensor::begin() {
    // Most flame modules have an internal pull-up; use INPUT to avoid conflict.
    // If your module needs INPUT_PULLUP, change here.
    pinMode(PIN_FLAME_DO, INPUT);
    _detected   = false;
    _pending    = false;
    _debCounter = 0;
    _lastPoll   = 0;
    Logger::log(LogLevel::INFO, "FireSensor: initialised");
}

// ──────────────────────────────────────────────────────────
void FireSensor::update(unsigned long now) {
    if (now - _lastPoll < WIRE_POLL_MS) return;
    _lastPoll = now;

    int raw    = digitalRead(PIN_FLAME_DO);
    // Determine if active: FLAME_ACTIVE_LOW=true means LOW = flame
    bool flame = FLAME_ACTIVE_LOW ? (raw == LOW) : (raw == HIGH);

    if (flame == _pending) {
        if (_debCounter < FLAME_DEBOUNCE_READS) _debCounter++;
    } else {
        _pending    = flame;
        _debCounter = 1;
    }

    if (_debCounter >= FLAME_DEBOUNCE_READS && _detected != _pending) {
        _detected = _pending;
        if (_detected) {
            Logger::log(LogLevel::CRITICAL, "CRITICAL: flame detected!");
        } else {
            Logger::log(LogLevel::INFO, "Flame cleared");
        }
    }
}
