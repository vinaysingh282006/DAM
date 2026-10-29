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
    pinMode(PIN_WIRE_LOW,     INPUT_PULLUP);
    pinMode(PIN_WIRE_MEDIUM,  INPUT_PULLUP);
    pinMode(PIN_WIRE_HIGH,    INPUT_PULLUP);
    pinMode(PIN_WIRE_WARNING, INPUT_PULLUP);

    _state     = {};
    _debLow    = 0;
    _debMedium = 0;
    _debHigh   = 0;
    _debWarning= 0;
    _lastPoll  = 0;

    Logger::log(LogLevel::INFO, "WaterLevel: initialised");
}

// ──────────────────────────────────────────────────────────
void WaterLevel::update(unsigned long now) {
    if (now - _lastPoll < WIRE_POLL_MS) return;
    _lastPoll = now;

    // Read raw states (INPUT_PULLUP: LOW = wire is WET)
    bool rawLow     = (digitalRead(PIN_WIRE_LOW)     == LOW);
    bool rawMedium  = (digitalRead(PIN_WIRE_MEDIUM)  == LOW);
    bool rawHigh    = (digitalRead(PIN_WIRE_HIGH)    == LOW);
    bool rawWarning = (digitalRead(PIN_WIRE_WARNING) == LOW);

    // Debounce each wire independently
    auto debounce = [](bool raw, bool& pending, uint8_t& counter, bool& committed) -> bool {
        if (raw == pending) {
            if (counter < WIRE_DEBOUNCE_READS) counter++;
        } else {
            // New state — reset counter and adopt new pending
            pending = raw;
            counter = 1;
        }
        if (counter >= WIRE_DEBOUNCE_READS) {
            if (committed != pending) {
                committed = pending;
                return true;  // state changed
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
    // ── Sanity check: higher wire wet, lower wire dry = probe fault ──
    // Order (low→high): LOW(25%) < MEDIUM(50%) < HIGH(75%) < WARNING(100%)
    bool fault = false;
    if (_state.medium  && !_state.low)    fault = true;
    if (_state.high    && !_state.medium) fault = true;
    if (_state.warning && !_state.high)   fault = true;

    if (fault != _state.probeFault) {
        _state.probeFault = fault;
        if (fault) {
            Logger::log(LogLevel::WARNING,
                "WARN: probe fault \u2014 higher wire wet, lower dry. Check wiring.");
        } else {
            Logger::log(LogLevel::INFO, "Probe fault cleared");
        }
    }

    // ── Level percentage ──
    // Always treat the highest wet wire as authoritative (safety-first)
    if (_state.warning)      _state.levelPercent = 100;
    else if (_state.high)    _state.levelPercent = 75;
    else if (_state.medium)  _state.levelPercent = 50;
    else if (_state.low)     _state.levelPercent = 25;
    else                     _state.levelPercent = 0;
}
