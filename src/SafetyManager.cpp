/**
 * @file SafetyManager.cpp
 * @brief AquaGuard — Safety logic implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "SafetyManager.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
SafetyManager::SafetyManager(WaterLevel& wl, GateFlow& gf, ServoGate& sg,
                              Pumps& pumps, FireSensor& fire, GasSensor& gas,
                              Ultrasonic& us)
    : _wl(wl), _gf(gf), _sg(sg), _pumps(pumps), _fire(fire), _gas(gas), _us(us)
{}

// ──────────────────────────────────────────────────────────
void SafetyManager::begin() {
    pinMode(PIN_BUZZER, OUTPUT);
    pinMode(PIN_LED,    OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_LED,    LOW);

#ifndef NATIVE_UNIT_TEST
    // LEDC for buzzer tone
    ledcSetup(BUZZER_LEDC_CH, BUZZER_SLOW_FREQ_HZ, 8);
    ledcAttachPin(PIN_BUZZER, BUZZER_LEDC_CH);
    ledcWrite(BUZZER_LEDC_CH, 0);
#endif

    _status    = SystemStatus::SAFE;
    _mode      = OperatingMode::AUTO;
    _alarms    = AlarmFlag::NONE;
    _gateCmd   = 0;
    _muted     = false;
    _interlocked = false;

    Logger::log(LogLevel::INFO, "SafetyManager: initialised (AUTO mode)");
}

// ──────────────────────────────────────────────────────────
void SafetyManager::update(unsigned long now) {
    const WaterLevelState& wls = _wl.getState();

    // ── Check all sensors and update alarms ───────────────

    // Fire
    _setAlarm(AlarmFlag::FIRE, _fire.isFlameDetected(),
              "CRITICAL: flame detected!", LogLevel::CRITICAL);

    // Gas
    GasLevel gasLvl = _gas.getLevel();
    _setAlarm(AlarmFlag::GAS_DANGER, gasLvl == GasLevel::DANGER,
              "CRITICAL: gas at dangerous level", LogLevel::CRITICAL);
    _setAlarm(AlarmFlag::GAS_WARN,
              gasLvl == GasLevel::WARNING && gasLvl != GasLevel::DANGER,
              "WARNING: gas elevated", LogLevel::WARNING);

    // Proximity
    ProximityZone zone = _us.getZone();
    _setAlarm(AlarmFlag::PROX_DANGER, zone == ProximityZone::DANGER,
              "PROX DANGER: object very close to gate", LogLevel::CRITICAL);
    _setAlarm(AlarmFlag::PROX_WARN,
              zone == ProximityZone::WARNING && zone != ProximityZone::DANGER,
              "PROX WARNING: keep away from gate", LogLevel::WARNING);
    _setAlarm(AlarmFlag::PROX_AUTO_WARN,
              zone != ProximityZone::CLEAR,
              "AUTO-WARNING: Object approaching spillway gate!", LogLevel::WARNING);

    // Sensor Disconnection Detection
    bool usFault   = _us.isDisconnected();
    bool gasFault  = _gas.isDisconnected();
    bool probeFault= wls.probeFault;
    bool anySensorFault = usFault || gasFault || probeFault;
    _setAlarm(AlarmFlag::SENSOR_FAULT, anySensorFault,
              "ERROR: Sensor disconnected or hardware fault detected!", LogLevel::CRITICAL);

    // DAM WARNING wire
    _setAlarm(AlarmFlag::DAM_WARNING, wls.warning,
              "CRITICAL: DAM WARNING wire active \u2014 flood risk!", LogLevel::CRITICAL);

    // Flow state alarms
    FlowState fs = _gf.getState();
    _setAlarm(AlarmFlag::FLOW_FAULT, fs == FlowState::FLOW_FAULT,
              "FLOW FAULT: gate open but no flow detected", LogLevel::WARNING);
    _setAlarm(AlarmFlag::LEAK_WARN, fs == FlowState::LEAK_WARNING,
              "LEAK WARNING: flow with gate closed", LogLevel::WARNING);

    // Probe fault
    _setAlarm(AlarmFlag::PROBE_FAULT, wls.probeFault,
              "WARN: probe fault \u2014 check water wire order", LogLevel::WARNING);

    // ── Proximity interlock ───────────────────────────────
    _applyInterlock();

    // ── Auto-mode gate control ────────────────────────────
    if (_mode == OperatingMode::AUTO) {
        _applyAutoMode();
    }

    // ── Pump auto-stop on DAM WARNING ─────────────────────
    if (wls.warning) {
        _pumps.autoStop();
    }

    // ── Pump dry-source alarm ─────────────────────────────
    // (The Pumps class handles the logging; we just mirror into alarms)
    bool pump1DryWarn = _pumps.getPump1().dryWarning;
    bool pump2DryWarn = _pumps.getPump2().dryWarning;
    _setAlarm(AlarmFlag::PUMP_DRY, pump1DryWarn || pump2DryWarn,
              "WARNING: pump running with no water at LOW wire", LogLevel::WARNING);

    // ── Compute overall status ────────────────────────────
    _computeStatus();

    // ── Buzzer and LED ────────────────────────────────────
    _updateBuzzer(now);
    _updateLED(now);
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_applyInterlock() {
    bool zone_blocks = (_us.getZone() != ProximityZone::CLEAR);
    const WaterLevelState& wls = _wl.getState();

    if (zone_blocks && !_overrideActive) {
        _interlocked = true;

        // If gate is currently moving, pause it
        if (_sg.isMoving()) {
            _sg.pause();
            Logger::log(LogLevel::WARNING,
                "Gate movement paused: object detected near gate");
        }

        // Flood safety: always allow OPENING even if interlocked
        // (Only closing is blocked during DAM WARNING)
        if (wls.warning && _gateCmd > static_cast<int>(_sg.getActualAngle())) {
            // Opening command during DAM WARNING — allow
            _sg.resume();
        }
    } else {
        if (_interlocked) {
            _interlocked = false;
            _sg.resume();
            _overrideActive = false;
        }
    }
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_applyAutoMode() {
    const WaterLevelState& wls = _wl.getState();

    int target = _gateCmd;  // keep last command by default

    if (wls.warning) {
        // DAM WARNING: gate fully open
        if (_gateCmd != AUTO_GATE_WARNING_DEG) {
            _gateCmd = AUTO_GATE_WARNING_DEG;
            Logger::log(LogLevel::CRITICAL,
                "AUTO: DAM WARNING active \u2014 gate fully opened to 100\u00b0");
        }
        target = AUTO_GATE_WARNING_DEG;
    } else if (wls.high) {
        // HIGH level: gate to 50°
        if (_gateCmd != AUTO_GATE_HIGH_DEG) {
            _gateCmd = AUTO_GATE_HIGH_DEG;
            Logger::log(LogLevel::WARNING,
                "AUTO: level HIGH \u2014 gate opened to 50\u00b0");
        }
        target = AUTO_GATE_HIGH_DEG;
    } else if (wls.levelPercent < AUTO_CLOSE_HYSTERESIS && _gateCmd > 0) {
        // Level below 50% and gate was open: close gradually
        if (_gateCmd != 0) {
            _gateCmd = 0;
            Logger::log(LogLevel::INFO,
                "AUTO: level normal \u2014 gate closing");
        }
        target = 0;
    }

    // Apply target (interlock still respected inside ServoGate)
    if (!_interlocked || (wls.warning && target > static_cast<int>(_sg.getActualAngle()))) {
        _sg.setTarget(target);
    }
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_computeStatus() {
    uint16_t critMask = AlarmFlag::FIRE | AlarmFlag::GAS_DANGER |
                        AlarmFlag::PROX_DANGER | AlarmFlag::DAM_WARNING |
                        AlarmFlag::SENSOR_FAULT;
    uint16_t warnMask = AlarmFlag::GAS_WARN | AlarmFlag::PROX_WARN |
                        AlarmFlag::PROX_AUTO_WARN |
                        AlarmFlag::FLOW_FAULT | AlarmFlag::LEAK_WARN |
                        AlarmFlag::PUMP_DRY   | AlarmFlag::PROBE_FAULT;

    SystemStatus newStatus;
    if (_alarms & critMask)      newStatus = SystemStatus::CRITICAL;
    else if (_alarms & warnMask) newStatus = SystemStatus::WARNING;
    else                         newStatus = SystemStatus::SAFE;

    if (newStatus != _status) {
        _status = newStatus;
        char buf[60];
        snprintf(buf, sizeof(buf), "System status: %s", systemStatusStr(_status));
        LogLevel lvl = (_status == SystemStatus::CRITICAL) ? LogLevel::CRITICAL :
                       (_status == SystemStatus::WARNING)  ? LogLevel::WARNING  : LogLevel::INFO;
        Logger::log(lvl, buf);
    }
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_updateBuzzer(unsigned long now) {
    if (_muted || _alarms == AlarmFlag::NONE) {
        // Silence buzzer
#ifndef NATIVE_UNIT_TEST
        ledcWrite(BUZZER_LEDC_CH, 0);
#endif
        _buzzerOn = false;
        return;
    }

    bool isCritical = (_status == SystemStatus::CRITICAL);
    unsigned long onTime  = isCritical ? BUZZER_FAST_ON_MS  : BUZZER_SLOW_ON_MS;
    unsigned long offTime = isCritical ? BUZZER_FAST_OFF_MS : BUZZER_SLOW_OFF_MS;
    int freq = isCritical ? BUZZER_FAST_FREQ_HZ : BUZZER_SLOW_FREQ_HZ;

    if (_buzzerOn && (now - _buzzerToggle) >= onTime) {
        _buzzerOn = false;
        _buzzerToggle = now;
#ifndef NATIVE_UNIT_TEST
        ledcWriteTone(BUZZER_LEDC_CH, 0);
#endif
    } else if (!_buzzerOn && (now - _buzzerToggle) >= offTime) {
        _buzzerOn = true;
        _buzzerToggle = now;
#ifndef NATIVE_UNIT_TEST
        ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
    }
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_updateLED(unsigned long now) {
    // SAFE: steady on; WARNING: slow blink; CRITICAL: fast blink
    unsigned long interval = (_status == SystemStatus::CRITICAL) ? 250 :
                             (_status == SystemStatus::WARNING)  ? 750 : 0;
    if (interval == 0) {
        digitalWrite(PIN_LED, HIGH);  // Steady on = SAFE
        return;
    }
    if ((now - _ledToggle) >= interval) {
        _ledState = !_ledState;
        _ledToggle = now;
        digitalWrite(PIN_LED, _ledState ? HIGH : LOW);
    }
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_setAlarm(uint16_t flag, bool set,
                               const char* msg, LogLevel lvl) {
    bool wasSet = (_alarms & flag) != 0;
    if (set && !wasSet) {
        _alarms |= flag;
        Logger::log(lvl, msg);
    } else if (!set && wasSet) {
        _alarms &= ~flag;
        char buf[80];
        snprintf(buf, sizeof(buf), "Alarm cleared: 0x%03X", flag);
        Logger::log(LogLevel::INFO, buf);
    }
}

// ──────────────────────────────────────────────────────────
void SafetyManager::setMode(OperatingMode m) {
    if (_mode == m) return;
    _mode = m;
    Logger::log(LogLevel::INFO,
        m == OperatingMode::AUTO ? "Mode: AUTO" : "Mode: MANUAL");
}

void SafetyManager::commandGate(int degrees) {
    if (_mode != OperatingMode::MANUAL) return;
    _gateCmd = constrain(degrees, SERVO_MIN_DEG, SERVO_MAX_DEG);
    if (!_interlocked) {
        _sg.setTarget(_gateCmd);
    } else {
        Logger::log(LogLevel::WARNING,
            "Gate movement blocked: object near gate. Use override to proceed.");
    }
}

void SafetyManager::acknowledgeAlarms() {
    _alarms = AlarmFlag::NONE;
    _muted  = false;
    Logger::log(LogLevel::INFO, "Alarms acknowledged by operator");
}

void SafetyManager::muteAlarm(bool mute) {
    _muted = mute;
    Logger::log(LogLevel::INFO, mute ? "Alarm muted" : "Alarm unmuted");
}

void SafetyManager::overrideInterlock() {
    _overrideActive = true;
    _interlocked    = false;
    _sg.resume();
    Logger::log(LogLevel::WARNING,
        "OVERRIDE: operator bypassed proximity interlock");
}
