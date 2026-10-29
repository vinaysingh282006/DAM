/**
 * @file WaterLevel.h
 * @brief AquaGuard — Water level wire reader with debounce and sanity checking
 *
 * Reads 4 level wires (LOW/MEDIUM/HIGH/WARNING) using INPUT_PULLUP.
 * Wire = WET when GPIO reads LOW (water bridges wire to common GND).
 *
 * Debounce: requires WIRE_DEBOUNCE_READS consecutive identical readings
 * before the state is accepted.
 *
 * Sanity check: if a higher wire is wet while a lower wire is dry,
 * sets probeFault = true and logs a warning.
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#pragma once
#ifndef NATIVE_UNIT_TEST
  #include <Arduino.h>
#else
  #include "ArduinoStub.h"
#endif
#include "config.h"
#include "pins.h"

/// Snapshot of all water level wire states
struct WaterLevelState {
    bool low;           ///< LOW wire is wet
    bool medium;        ///< MEDIUM wire is wet
    bool high;          ///< HIGH wire is wet
    bool warning;       ///< DAM WARNING wire is wet
    bool probeFault;    ///< Sanity violation detected
    int  levelPercent;  ///< 0 / 25 / 50 / 75 / 100
};

/**
 * @class WaterLevel
 * @brief Manages the 4 level detection wires
 */
class WaterLevel {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Poll wires and update debounce state.
     * @param now  Current millis() value
     * Call every loop iteration (non-blocking).
     */
    void update(unsigned long now);

    /// Return the latest validated state snapshot
    const WaterLevelState& getState() const { return _state; }

    /// True if the DAM WARNING wire is currently wet
    bool isDamWarning() const { return _state.warning; }

    /// True if any probe fault has been detected
    bool hasProbeFault() const { return _state.probeFault; }

private:
    WaterLevelState _state{};

    // Per-wire debounce counters
    uint8_t _debLow     = 0;
    uint8_t _debMedium  = 0;
    uint8_t _debHigh    = 0;
    uint8_t _debWarning = 0;

    // Pending states (candidates before debounce passes)
    bool _pendLow     = false;
    bool _pendMedium  = false;
    bool _pendHigh    = false;
    bool _pendWarning = false;

    unsigned long _lastPoll = 0;

    /// Read one wire with debounce; returns true when state has been committed
    bool _debounce(uint8_t pin, bool& pending, uint8_t& counter, bool& committed);

    /// Compute level% and run sanity check
    void _computeLevel();
};
