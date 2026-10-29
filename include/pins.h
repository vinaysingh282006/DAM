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
//  WATER LEVEL SENSING (HC-SR04 Ultrasonic Sensor on GPIO 32/33)
//  Replaces physical wires. Legacy GPIOs preserved as optional fallback.
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_WIRE_LOW      = 25;   ///< Optional legacy wire (~25%)
constexpr uint8_t PIN_WIRE_MEDIUM   = 26;   ///< Optional legacy wire (~50%)
constexpr uint8_t PIN_WIRE_HIGH     = 27;   ///< Optional legacy wire (~75%)
constexpr uint8_t PIN_WIRE_WARNING  = 14;   ///< Optional legacy wire (Near crest)
constexpr uint8_t PIN_WIRE_FLOW     = 13;   ///< Optional tailrace flow wire (Blue wire)

// ────────────────────────────────────────────────────────────
//  PUMPS — MJE3055T NPN POWER TRANSISTORS
//  Single GPIO pin per pump (Base connected via 220Ω - 1kΩ resistor)
// ────────────────────────────────────────────────────────────
constexpr uint8_t PIN_PUMP1         = 16;   ///< Pump 1 (Inlet) MJE3055T Base (GPIO 16)
constexpr uint8_t PIN_PUMP2         = 17;   ///< Pump 2 (Outlet) MJE3055T Base (GPIO 17)
constexpr uint8_t PIN_PUMP1_EN      = PIN_PUMP1; ///< Legacy alias
constexpr uint8_t PIN_PUMP2_EN      = PIN_PUMP2; ///< Legacy alias

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

