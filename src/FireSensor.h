/**
 * @file FireSensor.h
 * @brief AquaGuard — Flame sensor module (digital output)
 *
 * Reads a digital flame sensor module. Active level is configurable
 * via FLAME_ACTIVE_LOW in config.h (default: LOW = flame detected).
 * Debounced with FLAME_DEBOUNCE_READS consecutive reads.
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

/**
 * @class FireSensor
 * @brief Debounced flame/fire sensor reader
 */
class FireSensor {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Poll the sensor.
     * @param now  Current millis()
     * Call every loop() iteration.
     */
    void update(unsigned long now);

    /// True if flame is currently detected (debounced)
    bool isFlameDetected() const { return _detected; }

private:
    bool     _detected   = false;
    bool     _pending    = false;
    uint8_t  _debCounter = 0;
    unsigned long _lastPoll = 0;
};
