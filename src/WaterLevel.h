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

/// Snapshot of all water level states (Ultrasonic + virtual levels)
struct WaterLevelState {
    bool low;           ///< LOW level reached (>= 25%)
    bool medium;        ///< MEDIUM level reached (>= 50%)
    bool high;          ///< HIGH level reached (>= 75%)
    bool warning;       ///< DAM WARNING level reached (>= 95% / <= 5cm from sensor)
    bool probeFault;    ///< Ultrasonic disconnected / out of range
    int  levelPercent;  ///< Smooth continuous 0 - 100%
    float distanceCm;   ///< Distance from ultrasonic to water surface in cm
    float waterDepthCm; ///< Depth of water in reservoir (cm)
    float waterDepthIn; ///< Depth of water in reservoir (inches)
};

/**
 * @class WaterLevel
 * @brief Continuous ultrasonic water level reader with calibration and virtual levels
 */
class WaterLevel {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Update water level from HC-SR04 distance.
     * @param now Current millis()
     * @param distanceCm Distance to water surface in cm from ultrasonic sensor
     * @param usDisconnected True if ultrasonic sensor has no echo / disconnected
     */
    void update(unsigned long now, float distanceCm = -1.0f, bool usDisconnected = false);

    /// Return the latest validated state snapshot
    const WaterLevelState& getState() const { return _state; }

    /// True if the DAM WARNING (critical high water / <=5cm) is active
    bool isDamWarning() const { return _state.warning; }

    /// True if sensor fault has been detected
    bool hasProbeFault() const { return _state.probeFault; }

    /// Calibration: set distance at 100% full (e.g. 5cm) and 0% empty (e.g. 42cm)
    void setCalibration(float fullDistCm, float emptyDistCm) {
        _fullDistCm = fullDistCm;
        _emptyDistCm = emptyDistCm;
    }
    float getFullDistCm() const { return _fullDistCm; }
    float getEmptyDistCm() const { return _emptyDistCm; }

private:
    WaterLevelState _state{};
    float _fullDistCm  = WATER_FULL_DIST_CM;   ///< 5.0 cm default
    float _emptyDistCm = WATER_EMPTY_DIST_CM;  ///< 42.0 cm (~16.5") default
    unsigned long _lastPoll = 0;

    // Per-wire debounce counters (for legacy fallback if ever needed)
    uint8_t _debLow     = 0;
    uint8_t _debMedium  = 0;
    uint8_t _debHigh    = 0;
    uint8_t _debWarning = 0;
    bool _pendLow     = false;
    bool _pendMedium  = false;
    bool _pendHigh    = false;
    bool _pendWarning = false;

    void _computeLevel();
};
