/**
 * @file ServoGate.cpp
 * @brief AquaGuard — Servo gate controller implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "ServoGate.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
void ServoGate::begin() {
    _actualAngle  = 0.0f;
    _targetAngle  = 0;
    _paused       = false;
    _lastUpdate   = 0;
    _lastMoved    = 0;
    _attached     = false;

    _attach();
    _writeAngle(0.0f);

    Logger::log(LogLevel::INFO, "ServoGate: initialised, gate at 0 degrees");
}

// ──────────────────────────────────────────────────────────
void ServoGate::update(unsigned long now) {
    if (_paused) {
        // Still refresh timing to prevent delta explosion on resume
        _lastUpdate = now;
        return;
    }

    if (_lastUpdate == 0) {
        _lastUpdate = now;
        return;
    }

    float dt = (now - _lastUpdate) / 1000.0f;  // seconds
    _lastUpdate = now;

    float target  = static_cast<float>(_targetAngle);
    float delta   = target - _actualAngle;
    float maxStep = SERVO_SPEED_DEG_PER_S * dt;

    if (abs(delta) < 0.3f) {
        // Close enough — snap to target
        if (_actualAngle != target) {
            _actualAngle = target;
            _writeAngle(_actualAngle);
            _lastMoved = now;
        }
        // Check idle detach
        if (_attached && (now - _lastMoved) > SERVO_IDLE_DETACH_MS) {
            _detach();
        }
        return;
    }

    // Move toward target at capped speed
    float step = (delta > 0) ? min(delta, maxStep) : max(delta, -maxStep);
    _actualAngle += step;
    _actualAngle  = constrain(_actualAngle, (float)SERVO_MIN_DEG, (float)SERVO_MAX_DEG);

    if (!_attached) _attach();
    _writeAngle(_actualAngle);
    _lastMoved = now;
}

// ──────────────────────────────────────────────────────────
void ServoGate::setTarget(int degrees) {
    int clamped = constrain(degrees, SERVO_MIN_DEG, SERVO_MAX_DEG);
    if (clamped != _targetAngle) {
        _targetAngle = clamped;
        if (!_attached) _attach();
    }
}

// ──────────────────────────────────────────────────────────
void ServoGate::pause() {
    if (!_paused) {
        _paused = true;
        Logger::log(LogLevel::INFO, "ServoGate: movement paused (interlock)");
    }
}

void ServoGate::resume() {
    if (_paused) {
        _paused = false;
        Logger::log(LogLevel::INFO, "ServoGate: movement resumed");
    }
}

// ──────────────────────────────────────────────────────────
bool ServoGate::isMoving() const {
    return !_paused && (abs(_actualAngle - static_cast<float>(_targetAngle)) >= 0.3f);
}

// ──────────────────────────────────────────────────────────
void ServoGate::_attach() {
#ifndef NATIVE_UNIT_TEST
    _servo.attach(PIN_SERVO, SERVO_PWM_MIN_US, SERVO_PWM_MAX_US);
#endif
    _attached = true;
}

void ServoGate::_detach() {
#ifndef NATIVE_UNIT_TEST
    _servo.detach();
#endif
    _attached = false;
}

void ServoGate::_writeAngle(float angle) {
#ifndef NATIVE_UNIT_TEST
    // Map 0-100° → 0-100° on servo (within min/max pulse range)
    _servo.write(static_cast<int>(angle));
#else
    (void)angle;
#endif
}
