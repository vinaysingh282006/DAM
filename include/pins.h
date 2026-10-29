/**
 * @file pins.h
 * @brief AquaGuard Dam Control — GPIO Pin Map
 *
 * Single source of truth for all hardware GPIO assignments.
 * DO NOT reassign any pin without updating the wiring guide (docs/02-wiring-guide.md).
 *
 * Rules observed:
 *  - Pins 6-11 avoided (connected to internal flash)
 *  - Strapping pins 0, 12, 15 avoided for critical functions
 *  - Gas sensor uses GPIO 35 (ADC1 only — ADC2 is disabled during WiFi)
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#pragma once

// ────────────────────────────────────────────────────────────
//  SERVO GATE
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_SERVO         = 18;   ///< SG90/MG996R signal wire

// ────────────────────────────────────────────────────────────
//  WATER LEVEL WIRES (INPUT_PULLUP; LOW = wire is WET)
//  Common GND wire goes to ESP32 GND — not a GPIO.
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_WIRE_LOW      = 25;   ///< ~25% reservoir height (Green wire)
constexpr uint8_t PIN_WIRE_MEDIUM   = 26;   ///< ~50% reservoir height (Yellow wire)
constexpr uint8_t PIN_WIRE_HIGH     = 27;   ///< ~75% reservoir height (Orange wire)
constexpr uint8_t PIN_WIRE_WARNING  = 14;   ///< Near crest — overflow risk (Red wire)
constexpr uint8_t PIN_WIRE_FLOW     = 13;   ///< Downstream of gate (Blue wire)

// ────────────────────────────────────────────────────────────
//  L298N MOTOR DRIVER — PUMPS
//  Pump 1 on Channel A, Pump 2 on Channel B
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_PUMP1_IN1     = 16;   ///< L298N IN1
constexpr uint8_t PIN_PUMP1_IN2     = 17;   ///< L298N IN2
constexpr uint8_t PIN_PUMP1_EN      = 4;    ///< L298N ENA (PWM speed)
constexpr uint8_t PIN_PUMP2_IN1     = 19;   ///< L298N IN3
constexpr uint8_t PIN_PUMP2_IN2     = 21;   ///< L298N IN4
constexpr uint8_t PIN_PUMP2_EN      = 22;   ///< L298N ENB (PWM speed)

// ────────────────────────────────────────────────────────────
//  SENSORS
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_FLAME_DO      = 23;   ///< Flame sensor digital output
constexpr uint8_t PIN_GAS_AO        = 35;   ///< MQ gas sensor analog (ADC1 ch7, input-only)

// HC-SR04 Ultrasonic — ECHO passes through 1kΩ/2kΩ voltage divider → 3.3 V
constexpr uint8_t PIN_TRIG          = 32;   ///< HC-SR04 TRIG
constexpr uint8_t PIN_ECHO          = 33;   ///< HC-SR04 ECHO (via divider)

// ────────────────────────────────────────────────────────────
//  OUTPUTS
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_BUZZER        = 5;    ///< Active buzzer / LEDC tone
constexpr uint8_t PIN_LED           = 2;    ///< Onboard blue LED (status)

// ────────────────────────────────────────────────────────────
//  HYDRO-ELECTRIC TURBINE DEMO (DC Motor + Voltage/Current Sensing)
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_TURBINE_CTRL  = 15;   ///< PWM Control output (via MOSFET/Transistor to DC motor)
constexpr uint8_t PIN_TURBINE_VOLT  = 34;   ///< Generated/Incoming Voltage sensing (ADC1_CH6 via divider)

