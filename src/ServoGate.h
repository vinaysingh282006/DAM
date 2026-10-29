/**
 * @file ServoGate.h
 * @brief AquaGuard — Servo gate controller (smooth, non-blocking)
 *
 * Drives the SG90/MG996R servo via ESP32Servo library.
 * Range: 0-100 degrees (mapped to SERVO_PWM_MIN_US – SERVO_PWM_MAX_US).
 * Movement is smooth at SERVO_SPEED_DEG_PER_S degrees/second.
 * Servo detaches (stops jittering) after SERVO_IDLE_DETACH_MS of no movement.
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#pragma once
#ifndef NATIVE_UNIT_TEST
  #include <Arduino.h>
  #include <ESP32Servo.h>
#else
  #include "ArduinoStub.h"
  // Minimal Servo stub for native tests
  class Servo {
  public:
      void attach(int, int, int) {}
      void write(int) {}
      void detach() {}
      bool attached() { return false; }
  };
#endif
#include "config.h"
#include "pins.h"

/**
 * @class ServoGate
 * @brief Non-blocking servo gate controller with smooth movement
 */
class ServoGate {
public:
    /// Call once in setup()
    void begin();

    /**
     * @brief Update servo position toward target.
     * @param now  Current millis()
     * Must be called every loop() iteration.
     */
    void update(unsigned long now);

    /// Command the gate to a target angle (0–100°). Clamped silently.
    void setTarget(int degrees);

    /// Pause servo movement (proximity interlock). Resume with resume().
    void pause();

    /// Resume servo movement after pause.
    void resume();

    /// True if servo is currently moving
    bool isMoving() const;

    /// True if servo movement is paused (interlocked)
    bool isPaused() const { return _paused; }

    /// Current actual angle (float for smooth display)
    float getActualAngle() const { return _actualAngle; }

    /// Target angle in integer degrees
    int getTargetAngle() const { return _targetAngle; }

private:
    Servo         _servo;
    float         _actualAngle  = 0.0f;  ///< Current position (degrees, float for smoothing)
    int           _targetAngle  = 0;     ///< Commanded target (integer degrees)
    bool          _paused       = false;
    unsigned long _lastUpdate   = 0;
    unsigned long _lastMoved    = 0;     ///< millis() of last actual movement
    bool          _attached     = false;

    void _attach();
    void _detach();
    void _writeAngle(float angle);
};
