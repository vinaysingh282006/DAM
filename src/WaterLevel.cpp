/**
 * @file WaterLevel.cpp
 * @brief AquaGuard — Water level wire reader implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "WaterLevel.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
void WaterLevel::begin() {
    // Preserve legacy pin pullups in case they are ever probed
    pinMode(PIN_WIRE_LOW,     INPUT_PULLUP);
    pinMode(PIN_WIRE_MEDIUM,  INPUT_PULLUP);
    pinMode(PIN_WIRE_HIGH,    INPUT_PULLUP);
    pinMode(PIN_WIRE_WARNING, INPUT_PULLUP);

    _state       = {};
    _debLow      = 0;
    _debMedium   = 0;
    _debHigh     = 0;
    _debWarning  = 0;
    _lastPoll    = 0;
    _fullDistCm  = WATER_FULL_DIST_CM;   // 5.0 cm
    _emptyDistCm = WATER_EMPTY_DIST_CM;  // 42.0 cm (~16.5")

    Logger::log(LogLevel::INFO, "WaterLevel: initialised (HC-SR04 continuous ultrasonic mode)");
}

// ──────────────────────────────────────────────────────────
void WaterLevel::update(unsigned long now, float distanceCm, bool usDisconnected) {
    if (now - _lastPoll < WIRE_POLL_MS) return;
    _lastPoll = now;

    if (usDisconnected) {
        _state.probeFault = true;
        _state.distanceCm = -1.0f;
        return;
    }

    _state.probeFault = false;

    // ── Primary Mode: HC-SR04 Ultrasonic Sensor ───────────────
    if (distanceCm > 0.0f) {
        _state.distanceCm = distanceCm;

        // Linear interpolation from distance to 0-100%
        // distance <= _fullDistCm (5cm)  -> 100% full
        // distance >= _emptyDistCm (42cm) -> 0% empty
        float pct = 0.0f;
        if (distanceCm <= _fullDistCm) {
            pct = 100.0f;
        } else if (distanceCm >= _emptyDistCm) {
            pct = 0.0f;
        } else {
            pct = ((_emptyDistCm - distanceCm) / (_emptyDistCm - _fullDistCm)) * 100.0f;
        }

        _state.levelPercent = constrain(static_cast<int>(round(pct)), 0, 100);
        _state.waterDepthCm = max(0.0f, _emptyDistCm - distanceCm);
        _state.waterDepthIn = _state.waterDepthCm / 2.54f;

        // Virtual level flags for SCADA, alarms and automated spillway gate
        _state.warning = (_state.levelPercent >= 95 || distanceCm <= (_fullDistCm + 0.5f));
        _state.high    = (_state.levelPercent >= 75);
        _state.medium  = (_state.levelPercent >= 50);
        _state.low     = (_state.levelPercent >= 25);
        return;
    }

    // ── Fallback Mode: Physical Wire Probes (if ever attached) ──
    bool rawLow     = (digitalRead(PIN_WIRE_LOW)     == LOW);
    bool rawMedium  = (digitalRead(PIN_WIRE_MEDIUM)  == LOW);
    bool rawHigh    = (digitalRead(PIN_WIRE_HIGH)    == LOW);
    bool rawWarning = (digitalRead(PIN_WIRE_WARNING) == LOW);

    auto debounce = [](bool raw, bool& pending, uint8_t& counter, bool& committed) -> bool {
        if (raw == pending) {
            if (counter < WIRE_DEBOUNCE_READS) counter++;
        } else {
            pending = raw;
            counter = 1;
        }
        if (counter >= WIRE_DEBOUNCE_READS) {
            if (committed != pending) {
                committed = pending;
                return true;
            }
        }
        return false;
    };

    bool changedLow     = debounce(rawLow,     _pendLow,     _debLow,     _state.low);
    bool changedMedium  = debounce(rawMedium,  _pendMedium,  _debMedium,  _state.medium);
    bool changedHigh    = debounce(rawHigh,    _pendHigh,    _debHigh,    _state.high);
    bool changedWarning = debounce(rawWarning, _pendWarning, _debWarning, _state.warning);

    if (changedLow || changedMedium || changedHigh || changedWarning) {
        _computeLevel();
    }
}

// ──────────────────────────────────────────────────────────
void WaterLevel::_computeLevel() {
    bool fault = false;
    if (_state.medium  && !_state.low)    fault = true;
    if (_state.high    && !_state.medium) fault = true;
    if (_state.warning && !_state.high)   fault = true;

    if (fault != _state.probeFault) {
        _state.probeFault = fault;
    }

    if (_state.warning)      _state.levelPercent = 100;
    else if (_state.high)    _state.levelPercent = 75;
    else if (_state.medium)  _state.levelPercent = 50;
    else if (_state.low)     _state.levelPercent = 25;
    else                     _state.levelPercent = 0;
}
