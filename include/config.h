/**
 * @file config.h
 * @brief AquaGuard Dam Control — All Tuneable Constants
 *
 * Every magic number lives here. Change values here; do not scatter
 * literals throughout the codebase.
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#pragma once

// ────────────────────────────────────────────────────────────
//  WiFi Access Point
// ────────────────────────────────────────────────────────────
#define WIFI_SSID           "AquaGuard-Dam"
#define WIFI_PASS           "dam12345"
#define WIFI_CHANNEL        6
#define WIFI_MAX_CLIENTS    4

// ────────────────────────────────────────────────────────────
//  mDNS  →  resolves as  dam.local
// ────────────────────────────────────────────────────────────
#define MDNS_HOSTNAME       "dam"

// ────────────────────────────────────────────────────────────
//  WebSocket push rate
// ────────────────────────────────────────────────────────────
constexpr unsigned long WS_PUSH_INTERVAL_MS   = 500;   ///< ms between periodic pushes

// ────────────────────────────────────────────────────────────
//  Servo / Gate
// ────────────────────────────────────────────────────────────
constexpr int   SERVO_MIN_DEG           = 0;
constexpr int   SERVO_MAX_DEG           = 100;
constexpr int   SERVO_PWM_MIN_US        = 500;    ///< Pulse width at 0°  (SG90 & MG996R)
constexpr int   SERVO_PWM_MAX_US        = 2400;   ///< Pulse width at 180° (covers 0-100°)
constexpr float SERVO_SPEED_DEG_PER_S   = 60.0f; ///< Degrees per second (smooth movement)
constexpr unsigned long SERVO_IDLE_DETACH_MS = 2000; ///< Detach after this idle time (ms)

// ────────────────────────────────────────────────────────────
//  Water Level Wires
// ────────────────────────────────────────────────────────────
constexpr int   WIRE_DEBOUNCE_READS     = 5;   ///< Consecutive stable reads to change state
constexpr unsigned long WIRE_POLL_MS    = 50;  ///< ms between debounce samples

// ────────────────────────────────────────────────────────────
//  Gate Flow Confirmation
// ────────────────────────────────────────────────────────────
constexpr int   GATE_OPEN_THRESHOLD_DEG         = 10;     ///< Gate considered "open" above this
constexpr unsigned long FLOW_CONFIRM_TIMEOUT_MS = 5000;   ///< ms to wait for flow confirmation
constexpr unsigned long FLOW_LEAK_DETECT_MS     = 10000;  ///< ms gate closed before leak warning

// ────────────────────────────────────────────────────────────
//  Proximity Zones (HC-SR04)
// ────────────────────────────────────────────────────────────
constexpr float PROX_CLEAR_CM          = 40.0f;  ///< Distance for CLEAR zone
constexpr float PROX_WARN_CM           = 15.0f;  ///< Distance for WARNING zone
constexpr int   PROX_TRIGGER_COUNT     = 3;       ///< Consecutive detections to enter zone
constexpr int   PROX_CLEAR_COUNT       = 5;       ///< Consecutive clears to exit zone
constexpr int   PROX_MIN_VALID_CM      = 2;       ///< Ignore readings below this
constexpr int   PROX_MAX_VALID_CM      = 400;     ///< Ignore readings above this
constexpr int   PROX_SAMPLES           = 5;       ///< Median filter sample count
constexpr unsigned long PROX_INTERVAL_MS = 60;    ///< ms between ultrasonic readings

// ────────────────────────────────────────────────────────────
//  Pump
// ────────────────────────────────────────────────────────────
constexpr int   PUMP_PWM_FREQ_HZ       = 1000;   ///< LEDC frequency
constexpr int   PUMP_PWM_BITS          = 8;       ///< Resolution (0-255)
constexpr int   PUMP_LEDC_CH1          = 0;       ///< LEDC channel for Pump 1
constexpr int   PUMP_LEDC_CH2          = 1;       ///< LEDC channel for Pump 2
constexpr unsigned long PUMP_DRY_WARN_MS = 60000; ///< Warn if pump on & LOW dry for this long

// ────────────────────────────────────────────────────────────
//  Hydro-Electric Turbine Demo (DC Motor + Sensing)
// ────────────────────────────────────────────────────────────
constexpr int   TURBINE_LEDC_CH        = 4;       ///< LEDC channel for Turbine DC motor (Timer 2, isolated from buzzer Timer 1)
constexpr int   TURBINE_PWM_FREQ_HZ    = 1000;    ///< 1 kHz PWM
constexpr int   TURBINE_PWM_BITS       = 8;       ///< Resolution (0-255)
constexpr float TURBINE_VOLT_CAL_RATIO = 4.0f;    ///< Multiplier for 10k/3.3k divider to 12V max
constexpr float TURBINE_LOAD_RESISTOR  = 30.0f;   ///< Ohms load for current calculation

// ────────────────────────────────────────────────────────────
//  Sensor Disconnection Thresholds
// ────────────────────────────────────────────────────────────
constexpr int   US_DISCONNECT_ZERO_COUNT = 8;     ///< Consecutive 0-echo readings to flag disconnected ultrasonic
constexpr int   GAS_DISCONNECT_MIN_RAW   = 20;    ///< ADC raw below this indicates disconnected gas sensor


// ────────────────────────────────────────────────────────────
//  Gas Sensor (MQ series)
// ────────────────────────────────────────────────────────────
constexpr unsigned long GAS_WARMUP_MS  = 60000;  ///< Sensor warm-up period
constexpr int   GAS_WARN_THRESHOLD     = 1500;   ///< ADC raw value (0-4095) for WARNING
constexpr int   GAS_DANGER_THRESHOLD   = 2800;   ///< ADC raw value for DANGER

// ────────────────────────────────────────────────────────────
//  Flame Sensor
// ────────────────────────────────────────────────────────────
constexpr bool  FLAME_ACTIVE_LOW       = true;   ///< true = LOW means flame detected
constexpr int   FLAME_DEBOUNCE_READS   = 3;

// ────────────────────────────────────────────────────────────
//  Buzzer Tones & Timeout Configuration (LEDC channel 2)
// ────────────────────────────────────────────────────────────
constexpr int   BUZZER_LEDC_CH         = 2;
constexpr unsigned long BUZZER_MAX_DURATION_MS = 3800; ///< Maximum beep duration (3.8 seconds) before auto-silencing

// Frequencies for distinct, non-annoying tones:
constexpr int   BUZZER_FREQ_FIRE_HIGH  = 988;   ///< Fire alarm high tone (B5)
constexpr int   BUZZER_FREQ_FIRE_LOW   = 659;   ///< Fire alarm low tone (E5)
constexpr int   BUZZER_FREQ_GAS        = 750;   ///< Gas warning staccato tone
constexpr int   BUZZER_FREQ_PROX       = 1150;  ///< Proximity gate obstacle chirp
constexpr int   BUZZER_FREQ_FLOOD      = 440;   ///< Flood warning low resonance
constexpr int   BUZZER_FREQ_FAULT      = 600;   ///< Sensor disconnect/fault tone
constexpr int   BUZZER_FREQ_BOOT1      = 523;   ///< Boot chime note 1 (C5)
constexpr int   BUZZER_FREQ_BOOT2      = 659;   ///< Boot chime note 2 (E5)
constexpr int   BUZZER_FREQ_BOOT3      = 784;   ///< Boot chime note 3 (G5)

// ────────────────────────────────────────────────────────────
//  Auto Mode Gate Control
// ────────────────────────────────────────────────────────────
constexpr int   AUTO_GATE_HIGH_DEG     = 50;   ///< Open to this when HIGH wire wet
constexpr int   AUTO_GATE_WARNING_DEG  = 100;  ///< Full open on DAM WARNING
constexpr int   AUTO_CLOSE_HYSTERESIS  = 50;   ///< Close when level drops below 50%

// ────────────────────────────────────────────────────────────
//  Logger
// ────────────────────────────────────────────────────────────
constexpr int   LOG_RING_SIZE          = 50;   ///< Event ring buffer capacity

// ────────────────────────────────────────────────────────────
//  History Chart
// ────────────────────────────────────────────────────────────
constexpr int   HISTORY_POINTS         = 60;            ///< Last N data points
constexpr unsigned long HISTORY_INTERVAL_MS = 5000;     ///< Record every 5 s

// ────────────────────────────────────────────────────────────
//  Watchdog
// ────────────────────────────────────────────────────────────
constexpr int   WDT_TIMEOUT_S          = 10;

// ────────────────────────────────────────────────────────────
//  API Rate Limiting (0 = zero delay, immediate response)
// ────────────────────────────────────────────────────────────
constexpr unsigned long CMD_RATE_LIMIT_MS = 0; ///< Zero rate limiting: instant actuator response

// ────────────────────────────────────────────────────────────
//  Firmware Version
// ────────────────────────────────────────────────────────────
#define FW_VERSION          "1.0.0"
#define FW_BUILD_DATE       __DATE__
