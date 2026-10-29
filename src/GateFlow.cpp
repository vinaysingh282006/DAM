/**
 * @file GateFlow.cpp
 * @brief AquaGuard — Gate flow state machine implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "GateFlow.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
void GateFlow::begin() {
    pinMode(PIN_WIRE_FLOW, INPUT_PULLUP);
    reset();
    Logger::log(LogLevel::INFO, "GateFlow: initialised");
}

// ──────────────────────────────────────────────────────────
void GateFlow::reset() {
    _state      = FlowState::CLOSED;
    _openedAt   = 0;
    _closedAt   = 0;
    _confirmMs  = 0;
    _flowWet    = false;
    _pendFlow   = false;
    _debFlow    = 0;
    _wasGateOpen = false;
    _wasFlowWet  = false;
    _lastPoll    = 0;
}

// ──────────────────────────────────────────────────────────
bool GateFlow::_debounceFlow(unsigned long now) {
    if (now - _lastPoll < WIRE_POLL_MS) return false;
    _lastPoll = now;

    bool raw = (digitalRead(PIN_WIRE_FLOW) == LOW);  // LOW = wet

    if (raw == _pendFlow) {
        if (_debFlow < WIRE_DEBOUNCE_READS) _debFlow++;
    } else {
        _pendFlow = raw;
        _debFlow  = 1;
    }

    if (_debFlow >= WIRE_DEBOUNCE_READS) {
        if (_flowWet != _pendFlow) {
            _flowWet = _pendFlow;
            return true;  // state changed
        }
    }
    return false;
}

// ──────────────────────────────────────────────────────────
void GateFlow::update(unsigned long now, int gateAngle, bool lowWireWet) {
    bool flowChanged = _debounceFlow(now);
    bool gateOpen    = (gateAngle > GATE_OPEN_THRESHOLD_DEG);

    // ── Detect gate open edge ──────────────────────────────
    if (gateOpen && !_wasGateOpen) {
        // Gate just opened
        _openedAt  = now;
        _confirmMs = 0;
        if (_state == FlowState::CLOSED || _state == FlowState::FLOW_FAULT) {
            _setState(FlowState::OPENING);
        }
    }

    // ── Detect gate closed edge ────────────────────────────
    if (!gateOpen && _wasGateOpen) {
        // Gate just closed
        _closedAt = now;
        if (_state == FlowState::FLOW_CONFIRMED) {
            _setState(FlowState::FLOW_STOPPED);
        } else if (_state == FlowState::OPENING || _state == FlowState::FLOW_FAULT) {
            _setState(FlowState::CLOSED);
        }
    }

    _wasGateOpen = gateOpen;

    // ── Flow wire events ───────────────────────────────────
    if (flowChanged) {
        if (_flowWet) {
            // Flow wire just went WET
            if (_state == FlowState::OPENING) {
                _confirmMs = now - _openedAt;
                _setState(FlowState::FLOW_CONFIRMED);

                char buf[80];
                snprintf(buf, sizeof(buf),
                    "FLOW CONFIRMED: water flowing (%.1f s after gate opened)",
                    _confirmMs / 1000.0f);
                Logger::log(LogLevel::INFO, buf);
            }
        } else {
            // Flow wire just went DRY
            if (_state == FlowState::FLOW_STOPPED || _state == FlowState::LEAK_WARNING) {
                _setState(FlowState::CLOSED);
            }
        }
    }

    // ── Timeout checks ────────────────────────────────────
    switch (_state) {
        case FlowState::OPENING:
            // No flow confirmed within timeout?
            if ((now - _openedAt) >= FLOW_CONFIRM_TIMEOUT_MS) {
                if (lowWireWet) {
                    // Water in reservoir but no flow — blockage possible
                    _setState(FlowState::FLOW_FAULT);
                    Logger::log(LogLevel::WARNING,
                        "FLOW FAULT: gate open but no flow. Possible blockage or stuck gate.");
                } else {
                    // No water at LOW level — no flow is expected
                    _setState(FlowState::FLOW_FAULT);
                    Logger::log(LogLevel::INFO,
                        "FLOW: no water at LOW level, gate flow not expected.");
                }
            }
            break;

        case FlowState::FLOW_STOPPED:
            // Still wet 10 s after gate closed?
            if (_flowWet && (now - _closedAt) >= FLOW_LEAK_DETECT_MS) {
                _setState(FlowState::LEAK_WARNING);
                Logger::log(LogLevel::WARNING,
                    "LEAK WARNING: flow detected with gate closed. Possible leak.");
            }
            break;

        default:
            break;
    }
}

// ──────────────────────────────────────────────────────────
void GateFlow::_setState(FlowState s) {
    if (_state == s) return;
    _state = s;
    // Log state transition
    char buf[60];
    snprintf(buf, sizeof(buf), "GateFlow: -> %s", flowStateStr(s));
    Logger::log(LogLevel::INFO, buf);
}
