/**
 * @file Pumps.h
 * @brief AquaGuard — Dual DC pump controller via L298N + LEDC PWM
 *
 * Controls two DC pumps (Pump 1 = L298N Channel A, Pump 2 = Channel B).
 * Direction is forward-only (IN1=HIGH, IN2=LOW for forward).
 * Speed is controlled via PWM on ENA/ENB using ESP32 LEDC.
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

/// State of a single pump
struct PumpState {
    bool on          = false;   ///< Is pump running?
    uint8_t speedPct = 0;       ///< Speed 0-100%
    unsigned long startedAt = 0;///< millis() when pump was last turned on
    bool dryWarning  = false;   ///< Set if pump running long with LOW dry
};

/**
 * @class Pumps
 * @brief Controller for two DC pumps via MJE3055T NPN power transistors
 */
class Pumps {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Set pump state.
     * @param id       Pump number (1 or 2)
     * @param on       True = run, false = stop
     * @param speedPct Speed 0-100 (only used when on = true)
     * @param reverse  Ignored (kept for signature compatibility)
     */
    void setChannel(int id, bool on, int speedPct = 100, bool reverse = false);

    /// Auto-stop both pumps (called by SafetyManager on DAM WARNING)
    void autoStop();

    /// Reset auto-stopped flag when condition clears or operator overrides
    void resetAutoStop() { _autoStopped = false; }

    /**
     * @brief Update pump dry-source warning.
     * @param now       Current millis()
     * @param lowWireWet True if LOW level wire is wet
     */
    void update(unsigned long now, bool lowWireWet);

    /// Get state of pump 1
    const PumpState& getPump1() const { return _pump[0]; }
    /// Get state of pump 2
    const PumpState& getPump2() const { return _pump[1]; }

private:
    PumpState _pump[2];
    bool      _autoStopped = false;  ///< True if auto-stopped; cleared on manual command

    void _applyPump(int idx);
};
