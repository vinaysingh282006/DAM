/**
 * @file GateFlow.h
 * @brief AquaGuard — Gate flow confirmation state machine (FLOW wire)
 *
 * The FLOW wire is mounted downstream of the sliding gate.
 * It confirms that water is actually flowing through when the gate is open,
 * and detects leaks when the gate is closed.
 *
 * State Machine:
 *   CLOSED ──► OPENING ──► FLOW_CONFIRMED
 *                │ (timeout & LOW wet)
 *                ▼
 *            FLOW_FAULT
 *
 *   FLOW_CONFIRMED ──► FLOW_STOPPED ──► CLOSED (dry)
 *                                  └──► LEAK_WARNING (still wet after 10s)
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

/// All possible states for the gate flow system
enum class FlowState : uint8_t {
    CLOSED              = 0,  ///< Gate closed, no flow
    OPENING             = 1,  ///< Gate open, awaiting flow confirmation
    FLOW_CONFIRMED      = 2,  ///< Flow wire wet — water flowing
    FLOW_FAULT          = 3,  ///< Gate open, timeout, no flow (possible blockage)
    FLOW_STOPPED        = 4,  ///< Gate just closed, waiting for flow to stop
    LEAK_WARNING        = 5   ///< Gate closed, flow wire still wet after delay
};

/// String representation of flow state (for JSON)
inline const char* flowStateStr(FlowState s) {
    switch (s) {
        case FlowState::CLOSED:         return "CLOSED";
        case FlowState::OPENING:        return "OPENING";
        case FlowState::FLOW_CONFIRMED: return "FLOW_CONFIRMED";
        case FlowState::FLOW_FAULT:     return "FLOW_FAULT";
        case FlowState::FLOW_STOPPED:   return "FLOW_STOPPED";
        case FlowState::LEAK_WARNING:   return "LEAK_WARNING";
        default:                        return "UNKNOWN";
    }
}

/**
 * @class GateFlow
 * @brief FLOW wire state machine
 */
class GateFlow {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Update state machine.
     * @param now           Current millis()
     * @param gateAngle     Current servo angle (degrees)
     * @param lowWireWet    State of the LOW level wire (for FLOW_FAULT check)
     * Call every loop iteration.
     */
    void update(unsigned long now, int gateAngle, bool lowWireWet);

    /// Current flow state
    FlowState getState() const { return _state; }

    /// ms from gate open command to flow confirmed (0 if not confirmed)
    unsigned long getConfirmMs() const { return _confirmMs; }

    /// True if flow wire is currently wet (debounced)
    bool isFlowWet() const { return _flowWet; }

    /// Reset state machine (e.g. after reboot or manual clear)
    void reset();

private:
    FlowState     _state      = FlowState::CLOSED;
    unsigned long _openedAt   = 0;   ///< millis() when gate was commanded open
    unsigned long _closedAt   = 0;   ///< millis() when gate was commanded closed
    unsigned long _confirmMs  = 0;   ///< Time taken to confirm flow
    bool          _flowWet    = false;

    // FLOW wire debounce
    bool     _pendFlow  = false;
    uint8_t  _debFlow   = 0;

    unsigned long _lastPoll = 0;

    bool _wasGateOpen = false;       ///< Track gate open/close transitions
    bool _wasFlowWet  = false;       ///< Track flow wet/dry transitions

    void _setState(FlowState s);
    bool _debounceFlow(unsigned long now);
};
