/**
 * @file main.cpp
 * @brief AquaGuard Dam Control — Main Entry Point
 *
 * Initialises all modules and runs the non-blocking main loop.
 *
 * Loop priority order (all non-blocking):
 *  1. WaterLevel  — read debounced level wires
 *  2. GateFlow    — update flow state machine
 *  3. FireSensor  — read flame sensor
 *  4. GasSensor   — read gas sensor ADC
 *  5. Ultrasonic  — take proximity reading
 *  6. Pumps       — check dry-source warning
 *  7. SafetyManager — enforce all rules, drive gate and buzzer
 *  8. ServoGate   — smooth servo movement
 *  9. WebApi      — push WS state, handle DNS
 * 10. Watchdog    — feed watchdog timer
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#ifndef NATIVE_UNIT_TEST
#include <Arduino.h>
#include <WiFi.h>
#include <esp_task_wdt.h>

#include "config.h"
#include "pins.h"
#include "Logger.h"
#include "WaterLevel.h"
#include "GateFlow.h"
#include "ServoGate.h"
#include "Pumps.h"
#include "FireSensor.h"
#include "GasSensor.h"
#include "Ultrasonic.h"
#include "Turbine.h"
#include "SafetyManager.h"
#include "WebApi.h"

// ── Module instances ────────────────────────────────────────
WaterLevel    waterLevel;
GateFlow      gateFlow;
ServoGate     servoGate;
Pumps         pumps;
FireSensor    fireSensor;
GasSensor     gasSensor;
Ultrasonic    ultrasonic;
Turbine       turbine;

SafetyManager safetyManager(waterLevel, gateFlow, servoGate,
                             pumps, fireSensor, gasSensor, ultrasonic);

WebApi        webApi(safetyManager, waterLevel, gateFlow, servoGate,
                     pumps, fireSensor, gasSensor, ultrasonic, turbine);

// ──────────────────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(100);
    Serial.println("\n\n=== AquaGuard Dam Control v" FW_VERSION " ===");

    // ── 1. Logger first (everything else uses it) ──────────
    Logger::begin();

    // ── 2. Watchdog ────────────────────────────────────────
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(nullptr);
    Logger::log(LogLevel::INFO, "Watchdog: enabled (" + String(WDT_TIMEOUT_S) + "s)");

    // ── 3. Sensors and actuators ───────────────────────────
    waterLevel.begin();
    gateFlow.begin();
    servoGate.begin();
    pumps.begin();
    fireSensor.begin();
    gasSensor.begin();
    ultrasonic.begin();
    turbine.begin();
    safetyManager.begin();

    // ── 4. WiFi Access Point ───────────────────────────────
    Logger::log(LogLevel::INFO, "Starting WiFi AP: " WIFI_SSID);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(WIFI_SSID, WIFI_PASS, WIFI_CHANNEL, 0, WIFI_MAX_CLIENTS);
    delay(100);
    Logger::log(LogLevel::INFO, "AP IP: " + WiFi.softAPIP().toString());

    // ── 5. Web server (LittleFS + WS + REST + DNS) ─────────
    webApi.begin();

    Logger::log(LogLevel::INFO, "Setup complete. AquaGuard running.");
    Serial.println("=== Ready! Connect to WiFi: " WIFI_SSID " ===");
    Serial.println("=== Open: http://192.168.4.1  or  http://dam.local ===");
}

// ──────────────────────────────────────────────────────────
void loop() {
    unsigned long now = millis();

    // ── Sensor updates (non-blocking) ─────────────────────
    waterLevel.update(now);
    gateFlow.update(now, servoGate.getActualAngle(), waterLevel.getState().low);
    fireSensor.update(now);
    gasSensor.update(now);
    ultrasonic.update(now);

    // ── Actuator / logic updates ───────────────────────────
    pumps.update(now, waterLevel.getState().low);
    turbine.update(now);
    safetyManager.update(now);
    servoGate.update(now);

    // ── Network ───────────────────────────────────────────
    webApi.update(now);
    webApi.processDNS();

    // ── Watchdog feed ─────────────────────────────────────
    esp_task_wdt_reset();

    // No delay() — fully non-blocking
}
#endif // NATIVE_UNIT_TEST