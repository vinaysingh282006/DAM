/**
 * @file Ultrasonic.h
 * @brief AquaGuard — HC-SR04 proximity sensor (gate safety)
 *
 * Non-blocking state machine for HC-SR04 ultrasonic sensor.
 * Mounted on the FRONT of the gate to detect personnel/objects.
 * ECHO pin is connected via 1kΩ/2kΩ voltage divider for 3.3V safety.
 *
 * Zones (configurable in config.h):
 *   CLEAR   : distance > PROX_CLEAR_CM
 *   WARNING : PROX_WARN_CM < distance ≤ PROX_CLEAR_CM
 *   DANGER  : distance ≤ PROX_WARN_CM
 *
 * Hysteresis: PROX_TRIGGER_COUNT consecutive hits to enter zone,
 *             PROX_CLEAR_COUNT consecutive clears to exit zone.
 *
 * Median filter over PROX_SAMPLES readings.
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

/// Proximity zone for gate interlock
enum class ProximityZone : uint8_t {
    CLEAR   = 0,
    WARNING = 1,
    DANGER  = 2
};

inline const char* proximityZoneStr(ProximityZone z) {
    switch (z) {
        case ProximityZone::CLEAR:   return "CLEAR";
        case ProximityZone::WARNING: return "WARNING";
        case ProximityZone::DANGER:  return "DANGER";
        default:                     return "UNKNOWN";
    }
}

/**
 * @class Ultrasonic
 * @brief Non-blocking HC-SR04 proximity reader with hysteresis
 */
class Ultrasonic {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Update sensor readings.
     * @param now  Current millis()
     * Non-blocking; initiates a reading every PROX_INTERVAL_MS.
     */
    void update(unsigned long now);

    /// Latest median-filtered distance in cm (-1 = invalid/out of range)
    float getDistanceCm() const { return _distanceCm; }

    /// Current proximity zone (with hysteresis applied)
    ProximityZone getZone() const { return _zone; }

    /// True if zone is WARNING or DANGER
    bool isInterlocked() const {
        return _zone == ProximityZone::WARNING || _zone == ProximityZone::DANGER;
    }

    /// True if HC-SR04 is disconnected (persistent zero-echo/timeout)
    bool isDisconnected() const { return _disconnected; }

private:
    bool          _disconnected = false;
    int           _zeroEchoCount = 0;

    // Sensor state machine
    enum class USState { IDLE, TRIGGERED, WAIT_ECHO };
    USState       _usState      = USState::IDLE;
    unsigned long _trigTime     = 0;
    unsigned long _echoStart    = 0;

    // Filtered distance
    float         _distanceCm   = -1.0f;
    float         _samples[PROX_SAMPLES] = {};
    int           _sampleIdx    = 0;
    int           _sampleCount  = 0;

    // Hysteresis counters
    ProximityZone _zone              = ProximityZone::CLEAR;
    int           _warnCounter       = 0;
    int           _dangerCounter     = 0;
    int           _clearCounter      = 0;

    unsigned long _lastReading       = 0;

    float _medianFilter();
    void  _updateZone(float cm);
    void  _triggerReading(unsigned long now);
};
