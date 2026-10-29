/**
 * @file GasSensor.h
 * @brief AquaGuard — MQ-series toxic gas sensor (analog)
 *
 * Reads the MQ sensor via ADC1 on GPIO 35.
 * Shows a WARMUP state for GAS_WARMUP_MS after boot.
 * Returns WARNING or DANGER when raw ADC exceeds thresholds.
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

/// Gas sensor operational level
enum class GasLevel : uint8_t {
    WARMUP       = 0,  ///< Sensor not yet warmed up
    NORMAL       = 1,  ///< Below warning threshold
    WARNING      = 2,  ///< Above warning, below danger
    DANGER       = 3,  ///< Above danger threshold
    DISCONNECTED = 4   ///< Open circuit / sensor detached
};

inline const char* gasLevelStr(GasLevel l) {
    switch (l) {
        case GasLevel::WARMUP:       return "WARMUP";
        case GasLevel::NORMAL:       return "NORMAL";
        case GasLevel::WARNING:      return "WARNING";
        case GasLevel::DANGER:       return "DANGER";
        case GasLevel::DISCONNECTED: return "DISCONNECTED";
        default:                     return "UNKNOWN";
    }
}


/**
 * @class GasSensor
 * @brief MQ-series analog gas sensor reader
 */
class GasSensor {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Poll the sensor.
     * @param now  Current millis()
     */
    void update(unsigned long now);

    /// Raw ADC value (0-4095)
    int getRawValue() const { return _rawValue; }

    /// Gas operational level (WARMUP / NORMAL / WARNING / DANGER)
    GasLevel getLevel() const { return _level; }

    /// Seconds remaining in warm-up (0 if ready)
    int getWarmupSecondsRemaining() const;

    /// True if sensor is warmed up
    bool isWarmedUp() const;

    /// True if gas sensor is disconnected (open circuit / near zero ADC)
    bool isDisconnected() const { return _disconnected; }

private:
    int           _rawValue      = 0;
    GasLevel      _level         = GasLevel::WARMUP;
    GasLevel      _prevLevel     = GasLevel::WARMUP;
    bool          _disconnected  = false;
    int           _lowCount      = 0;
    unsigned long _startMs       = 0;   ///< millis() at begin()
    unsigned long _lastPoll      = 0;
    static constexpr unsigned long _POLL_MS = 500; ///< Sample every 500ms
};
