/**
 * @file Turbine.h
 * @brief AquaGuard — Hydro-Electric Turbine Demo (DC Motor + Live Telemetry)
 *
 * Controls a DC motor representing a hydro-electric turbine or water generator.
 * Uses PWM on PIN_TURBINE_CTRL (GPIO 15, LEDC Ch 3) to drive the motor.
 * Measures generated/operating voltage on PIN_TURBINE_VOLT (GPIO 34, ADC1_CH6).
 * Computes live Voltage (V), Current (mA), Power (mW), and estimated RPM.
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
 * @class Turbine
 * @brief Hydro-electric generator / DC motor manager
 */
class Turbine {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Periodic update for ADC voltage/current sensing.
     * @param now  Current millis()
     */
    void update(unsigned long now);

    /**
     * @brief Control the turbine motor.
     * @param on       Enable or disable motor
     * @param speedPct PWM speed percentage (0-100)
     */
    void setControl(bool on, int speedPct = 100);

    // ── Telemetry Accessors ────────────────────────────────
    bool  isOn()        const { return _on; }
    int   getSpeed()    const { return _speedPct; }
    float getVoltage()  const { return _voltage; }
    float getCurrentMa()const { return _currentMa; }
    float getPowerMw()  const { return _powerMw; }
    int   getRpm()      const { return _rpm; }

private:
    bool          _on         = false;
    int           _speedPct   = 0;
    float         _voltage    = 0.0f;
    float         _currentMa  = 0.0f;
    float         _powerMw    = 0.0f;
    int           _rpm        = 0;

    unsigned long _lastSample = 0;
    static constexpr unsigned long _SAMPLE_INTERVAL_MS = 100;
};
