/**
 * @file SafetyManager.h
 * @brief AquaGuard — Central safety logic coordinator
 *
 * Aggregates all sensor states, enforces all safety rules, manages
 * the proximity interlock, controls the buzzer and status LED,
 * and provides the overall system status (SAFE/WARNING/CRITICAL).
 *
 * Safety Rules (see docs/06-safety-logic.md for full table):
 *  1. HIGH wet (auto)     → gate to 50°
 *  2. DAM WARNING (auto)  → gate to 100°, pumps stop, CRITICAL
 *  3. Level < MEDIUM      → close gate gradually (hysteresis)
 *  4. Proximity WARNING   → gate paused, slow beep
 *  5. Proximity DANGER    → gate paused, fast buzzer
 *  6. Flame detected      → CRITICAL, fast buzzer
 *  7. Gas WARNING         → WARNING, slow beep
 *  8. Gas DANGER          → CRITICAL, fast buzzer
 *  9. Pump dry-source     → WARNING
 * 10. DAM WARNING + prox  → gate opening always allowed; closing blocked
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
#include "Logger.h"
#include "WaterLevel.h"
#include "GateFlow.h"
#include "ServoGate.h"
#include "Pumps.h"
#include "FireSensor.h"
#include "GasSensor.h"
#include "Ultrasonic.h"

/// Overall system status (worst active alarm)
enum class SystemStatus : uint8_t {
    SAFE     = 0,
    WARNING  = 1,
    CRITICAL = 2
};

inline const char* systemStatusStr(SystemStatus s) {
    switch (s) {
        case SystemStatus::SAFE:     return "SAFE";
        case SystemStatus::WARNING:  return "WARNING";
        case SystemStatus::CRITICAL: return "CRITICAL";
        default:                     return "UNKNOWN";
    }
}

/// Operating mode (MANUAL is strictly default 0 for operator autonomy)
enum class OperatingMode : uint8_t {
    MANUAL = 0,
    AUTO   = 1
};

/// Distinct buzzer tone patterns
enum class BuzzerPattern : uint8_t {
    SILENT = 0,
    BOOT,       ///< Ascending 3-note power-on melody
    FIRE,       ///< Alternating dual-tone high-urgency siren
    GAS,        ///< 3-burst staccato warning
    PROX,       ///< Tactical sonar chirps
    FLOOD,      ///< Low-frequency continuous horn
    FAULT       ///< Soft double-pip fault indicator
};

/// Active alarms bitmask
namespace AlarmFlag {
    constexpr uint16_t NONE           = 0x0000;
    constexpr uint16_t FIRE           = 0x0001;
    constexpr uint16_t GAS_WARN       = 0x0002;
    constexpr uint16_t GAS_DANGER     = 0x0004;
    constexpr uint16_t PROX_WARN      = 0x0008;
    constexpr uint16_t PROX_DANGER    = 0x0010;
    constexpr uint16_t DAM_WARNING    = 0x0020;
    constexpr uint16_t FLOW_FAULT     = 0x0040;
    constexpr uint16_t LEAK_WARN      = 0x0080;
    constexpr uint16_t PUMP_DRY       = 0x0100;
    constexpr uint16_t PROBE_FAULT    = 0x0200;
    constexpr uint16_t SENSOR_FAULT   = 0x0400;  ///< Disconnected sensor (US, Gas, Probe)
    constexpr uint16_t PROX_AUTO_WARN = 0x0800;  ///< Auto proximity warning near spillway
}

/**
 * @class SafetyManager
 * @brief Aggregates sensors, enforces rules, controls buzzer+LED
 */
class SafetyManager {
public:
    SafetyManager(WaterLevel& wl, GateFlow& gf, ServoGate& sg,
                  Pumps& pumps, FireSensor& fire, GasSensor& gas,
                  Ultrasonic& us);

    /// Call once in setup()
    void begin();

    /**
     * @brief Run all safety checks and act.
     * @param now  Current millis()
     * Must be called every loop().
     */
    void update(unsigned long now);

    // ── State accessors ────────────────────────────────────

    SystemStatus  getStatus()       const { return _status; }
    OperatingMode getMode()         const { return _mode; }
    uint16_t      getAlarms()       const { return _alarms; }
    bool          isInterlocked()   const { return _interlocked; }
    bool          isMuted()         const { return _muted; }

    // Commanded gate target (set by auto-mode or API)
    int getCommandedGateAngle()     const { return _gateCmd; }

    // ── Commands from WebApi ────────────────────────────────

    void setMode(OperatingMode m);
    void commandGate(int degrees);       ///< Manual gate command (manual mode only)
    void acknowledgeAlarms();            ///< Clear latched alarms (mute buzzer)
    void muteAlarm(bool mute);

    /**
     * @brief Override proximity interlock (logged).
     * Called after user confirms the hold-to-confirm dialog.
     */
    void overrideInterlock();

private:
    WaterLevel& _wl;
    GateFlow&   _gf;
    ServoGate&  _sg;
    Pumps&      _pumps;
    FireSensor& _fire;
    GasSensor&  _gas;
    Ultrasonic& _us;

    SystemStatus  _status      = SystemStatus::SAFE;
    OperatingMode _mode        = OperatingMode::MANUAL;
    uint16_t      _alarms      = AlarmFlag::NONE;
    bool          _interlocked = false;
    bool          _muted       = false;
    int           _gateCmd     = 0;       ///< Last commanded gate angle

    // Buzzer state machine with automatic timeout
    BuzzerPattern _buzzerPattern   = BuzzerPattern::SILENT;
    bool          _buzzerActive    = false;
    bool          _buzzerOn        = false;
    unsigned long _buzzerStartTime = 0;
    uint16_t      _lastAlarmFlags  = AlarmFlag::NONE;

    // Status LED
    unsigned long _ledToggle   = 0;
    bool          _ledState    = false;

    // Override tracking
    bool          _overrideActive = false;

    void _applyAutoMode();
    void _applyInterlock();
    void _triggerBuzzer(BuzzerPattern pattern, unsigned long now);
    void _updateBuzzer(unsigned long now);
    void _updateLED(unsigned long now);
    void _computeStatus();
    void _setAlarm(uint16_t flag, bool set, const char* msg, LogLevel lvl);
};
