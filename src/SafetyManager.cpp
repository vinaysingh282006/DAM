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
    // LEDC for buzzer tone on PIN_BUZZER (GPIO 5)
    ledcSetup(BUZZER_LEDC_CH, 2000, 8);
    ledcAttachPin(PIN_BUZZER, BUZZER_LEDC_CH);
    ledcWrite(BUZZER_LEDC_CH, 0);
#endif

    _status    = SystemStatus::SAFE;
    _mode      = OperatingMode::MANUAL;
    _alarms    = AlarmFlag::NONE;
    _gateCmd   = 0;
    _muted     = false;
    _interlocked = false;

    // Pleasant startup chime (600ms melody, then automatically silent)
    _triggerBuzzer(BuzzerPattern::BOOT, millis());

    Logger::log(LogLevel::INFO, "SafetyManager: initialised (MANUAL mode, buzzer on GPIO 5)");
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
    // ONLY active in AUTO mode. In MANUAL mode, the operator has 100% authority.
    if (_mode == OperatingMode::AUTO) {
        if (wls.warning) {
            _pumps.autoStop();
        } else {
            _pumps.resetAutoStop();
        }
    }

    // ── Pump dry-source alarm ─────────────────────────────
    // (The Pumps class handles the logging; we just mirror into alarms)
    bool pump1DryWarn = _pumps.getPump1().dryWarning;
    bool pump2DryWarn = _pumps.getPump2().dryWarning;
    _setAlarm(AlarmFlag::PUMP_DRY, pump1DryWarn || pump2DryWarn,
              "WARNING: pump running with no water at LOW wire", LogLevel::WARNING);

    // ── Trigger distinct buzzer tone for 3 to 5 seconds on new alarms ──
    uint16_t newAlarms = _alarms & ~_lastAlarmFlags;
    if (newAlarms != 0 && !_muted) {
        if (newAlarms & AlarmFlag::FIRE) {
            _triggerBuzzer(BuzzerPattern::FIRE, now);
        } else if (newAlarms & (AlarmFlag::GAS_DANGER | AlarmFlag::GAS_WARN)) {
            _triggerBuzzer(BuzzerPattern::GAS, now);
        } else if (newAlarms & (AlarmFlag::PROX_DANGER | AlarmFlag::PROX_WARN | AlarmFlag::PROX_AUTO_WARN)) {
            _triggerBuzzer(BuzzerPattern::PROX, now);
        } else if (newAlarms & AlarmFlag::DAM_WARNING) {
            _triggerBuzzer(BuzzerPattern::FLOOD, now);
        } else {
            _triggerBuzzer(BuzzerPattern::FAULT, now);
        }
    }
    _lastAlarmFlags = _alarms;

    // ── Compute overall status ────────────────────────────
    _computeStatus();

    // ── Buzzer and LED ────────────────────────────────────
    _updateBuzzer(now);
    _updateLED(now);
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_applyInterlock() {
    if (_mode == OperatingMode::MANUAL) {
        // Human operator has absolute authority in MANUAL mode — never pause servo
        if (_interlocked) {
            _interlocked = false;
            _sg.resume();
        }
        return;
    }

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
void SafetyManager::_triggerBuzzer(BuzzerPattern pattern, unsigned long now) {
    if (_muted) return;
    _buzzerPattern   = pattern;
    _buzzerActive    = true;
    _buzzerStartTime = now;
}

// ──────────────────────────────────────────────────────────
void SafetyManager::_updateBuzzer(unsigned long now) {
    if (!_buzzerActive || _muted) {
        if (_buzzerOn) {
#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, 0);
            ledcWrite(BUZZER_LEDC_CH, 0);
#endif
            _buzzerOn = false;
        }
        return;
    }

    // ── Auto-silence rule: 3 to 5 seconds max (3.8s), then STOPS even if flags stay up! ──
    unsigned long maxDuration = (_buzzerPattern == BuzzerPattern::BOOT) ? 700 : BUZZER_MAX_DURATION_MS;
    if ((now - _buzzerStartTime) >= maxDuration) {
        _buzzerActive  = false;
        _buzzerOn      = false;
        _buzzerPattern = BuzzerPattern::SILENT;
#ifndef NATIVE_UNIT_TEST
        ledcWriteTone(BUZZER_LEDC_CH, 0);
        ledcWrite(BUZZER_LEDC_CH, 0);
#endif
        return;
    }

    // ── Distinct tone patterns for different purposes ──
    switch (_buzzerPattern) {
        case BuzzerPattern::BOOT: {
            // Pleasant 3-note power-on melody: C5 (523Hz) -> E5 (659Hz) -> G5 (784Hz)
            unsigned long elapsed = now - _buzzerStartTime;
            int freq = 0;
            if (elapsed < 160) freq = BUZZER_FREQ_BOOT1;
            else if (elapsed < 320) freq = BUZZER_FREQ_BOOT2;
            else if (elapsed < 550) freq = BUZZER_FREQ_BOOT3;
            else freq = 0;

#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
            _buzzerOn = (freq > 0);
            break;
        }

        case BuzzerPattern::FIRE: {
            // European dual-tone sweep: 988Hz <-> 659Hz alternating every 160ms
            unsigned long phase = ((now - _buzzerStartTime) / 160) % 2;
            int freq = (phase == 0) ? BUZZER_FREQ_FIRE_HIGH : BUZZER_FREQ_FIRE_LOW;
#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
            _buzzerOn = true;
            break;
        }

        case BuzzerPattern::GAS: {
            // Staccato 3-burst pulses: 750Hz (70ms on, 50ms off, 3 times, then 300ms pause)
            unsigned long cycle = (now - _buzzerStartTime) % 660;
            bool on = (cycle < 70) || (cycle >= 120 && cycle < 190) || (cycle >= 240 && cycle < 310);
            int freq = on ? BUZZER_FREQ_GAS : 0;
#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
            _buzzerOn = on;
            break;
        }

        case BuzzerPattern::PROX: {
            // Sonar obstacle chirp: 1150Hz pulses (80ms on, 100ms off)
            unsigned long cycle = (now - _buzzerStartTime) % 180;
            bool on = (cycle < 80);
            int freq = on ? BUZZER_FREQ_PROX : 0;
#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
            _buzzerOn = on;
            break;
        }

        case BuzzerPattern::FLOOD: {
            // Heavy warning tone: 440Hz low horn (280ms on, 140ms off)
            unsigned long cycle = (now - _buzzerStartTime) % 420;
            bool on = (cycle < 280);
            int freq = on ? BUZZER_FREQ_FLOOD : 0;
#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
            _buzzerOn = on;
            break;
        }

        case BuzzerPattern::FAULT:
        default: {
            // Soft double-pip fault indicator: 600Hz (60ms on, 60ms off, 60ms on, 500ms pause)
            unsigned long cycle = (now - _buzzerStartTime) % 680;
            bool on = (cycle < 60) || (cycle >= 120 && cycle < 180);
            int freq = on ? BUZZER_FREQ_FAULT : 0;
#ifndef NATIVE_UNIT_TEST
            ledcWriteTone(BUZZER_LEDC_CH, freq);
#endif
            _buzzerOn = on;
            break;
        }
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
    _mode = OperatingMode::MANUAL; // Operator command automatically switches to manual mode
    _interlocked = false;
    _overrideActive = true;
    _sg.resume();
    _gateCmd = constrain(degrees, SERVO_MIN_DEG, SERVO_MAX_DEG);
    _sg.setTarget(_gateCmd);
    char buf[64];
    snprintf(buf, sizeof(buf), "Gate commanded to %d degrees (MANUAL)", _gateCmd);
    Logger::log(LogLevel::INFO, buf);
}

void SafetyManager::acknowledgeAlarms() {
    _alarms = AlarmFlag::NONE;
    _muted  = false;
    _buzzerActive = false;
    _buzzerOn = false;
#ifndef NATIVE_UNIT_TEST
    ledcWriteTone(BUZZER_LEDC_CH, 0);
    ledcWrite(BUZZER_LEDC_CH, 0);
#endif
    Logger::log(LogLevel::INFO, "Alarms acknowledged by operator");
}

void SafetyManager::muteAlarm(bool mute) {
    _muted = mute;
    if (mute) {
        _buzzerActive = false;
        _buzzerOn = false;
#ifndef NATIVE_UNIT_TEST
        ledcWriteTone(BUZZER_LEDC_CH, 0);
        ledcWrite(BUZZER_LEDC_CH, 0);
#endif
    }
    Logger::log(LogLevel::INFO, mute ? "Alarm muted" : "Alarm unmuted");
}

void SafetyManager::overrideInterlock() {
    _overrideActive = true;
    _interlocked    = false;
    _sg.resume();
    Logger::log(LogLevel::WARNING,
        "OVERRIDE: operator bypassed proximity interlock");
}
