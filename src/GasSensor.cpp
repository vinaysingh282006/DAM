/**
 * @file GasSensor.cpp
 * @brief AquaGuard — MQ gas sensor implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "GasSensor.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
void GasSensor::begin() {
    pinMode(PIN_GAS_AO, INPUT);
#ifndef NATIVE_UNIT_TEST
    _startMs = millis();
#else
    _startMs = 0;
#endif
    _rawValue  = 0;
    _level     = GasLevel::WARMUP;
    _prevLevel = GasLevel::WARMUP;
    _lastPoll  = 0;
    Logger::log(LogLevel::INFO, "GasSensor: warming up...");
}

// ──────────────────────────────────────────────────────────
bool GasSensor::isWarmedUp() const {
#ifndef NATIVE_UNIT_TEST
    return (millis() - _startMs) >= GAS_WARMUP_MS;
#else
    return true;
#endif
}

int GasSensor::getWarmupSecondsRemaining() const {
    if (isWarmedUp()) return 0;
#ifndef NATIVE_UNIT_TEST
    unsigned long elapsed = millis() - _startMs;
    return static_cast<int>((GAS_WARMUP_MS - elapsed) / 1000);
#else
    return 0;
#endif
}

// ──────────────────────────────────────────────────────────
void GasSensor::update(unsigned long now) {
    if (now - _lastPoll < _POLL_MS) return;
    _lastPoll = now;

    if (!isWarmedUp()) {
        _level = GasLevel::WARMUP;
        return;
    }

    _rawValue = analogRead(PIN_GAS_AO);

    GasLevel newLevel;
    if (_rawValue <= GAS_DISCONNECT_MIN_RAW) {
        _lowCount++;
        if (_lowCount >= 4) { // ~2 seconds of consecutive zero/near-zero
            _disconnected = true;
            newLevel = GasLevel::DISCONNECTED;
        } else {
            newLevel = _prevLevel;
        }
    } else {
        _lowCount = 0;
        _disconnected = false;
        if (_rawValue >= GAS_DANGER_THRESHOLD) {
            newLevel = GasLevel::DANGER;
        } else if (_rawValue >= GAS_WARN_THRESHOLD) {
            newLevel = GasLevel::WARNING;
        } else {
            newLevel = GasLevel::NORMAL;
        }
    }

    if (newLevel != _prevLevel) {
        _level     = newLevel;
        _prevLevel = newLevel;

        char buf[80];
        if (newLevel == GasLevel::DISCONNECTED) {
            snprintf(buf, sizeof(buf),
                "ERROR: MQ gas sensor DISCONNECTED (raw=%d <= %d)", _rawValue, GAS_DISCONNECT_MIN_RAW);
            Logger::log(LogLevel::CRITICAL, buf);
        } else if (newLevel == GasLevel::DANGER) {
            snprintf(buf, sizeof(buf),
                "CRITICAL: gas dangerous (raw=%d, threshold=%d)", _rawValue, GAS_DANGER_THRESHOLD);
            Logger::log(LogLevel::CRITICAL, buf);
        } else if (newLevel == GasLevel::WARNING) {
            snprintf(buf, sizeof(buf),
                "WARNING: gas elevated (raw=%d, threshold=%d)", _rawValue, GAS_WARN_THRESHOLD);
            Logger::log(LogLevel::WARNING, buf);
        } else {
            Logger::log(LogLevel::INFO, "Gas level: NORMAL");
        }
    } else {
        _level = newLevel;
    }
}
