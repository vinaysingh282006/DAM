/**
 * @file Turbine.cpp
 * @brief AquaGuard — Hydro-Electric Turbine Demo Implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "Turbine.h"
#include "Logger.h"

// ──────────────────────────────────────────────────────────
void Turbine::begin() {
    pinMode(PIN_TURBINE_VOLT, INPUT);

#ifndef NATIVE_UNIT_TEST
    ledcSetup(TURBINE_LEDC_CH, TURBINE_PWM_FREQ_HZ, TURBINE_PWM_BITS);
    ledcAttachPin(PIN_TURBINE_CTRL, TURBINE_LEDC_CH);
    ledcWrite(TURBINE_LEDC_CH, 0);
#endif

    _on        = false;
    _speedPct  = 0;
    _voltage   = 0.0f;
    _currentMa = 0.0f;
    _powerMw   = 0.0f;
    _rpm       = 0;
    _lastSample= 0;

    Logger::log(LogLevel::INFO, "Turbine: initialised (GPIO 15 PWM, GPIO 34 ADC)");
}

// ──────────────────────────────────────────────────────────
void Turbine::setControl(bool on, int speedPct) {
    _on = on;
    if (_on && speedPct <= 0) speedPct = 85;
    _speedPct = constrain(speedPct, 0, 100);

#ifndef NATIVE_UNIT_TEST
    uint32_t duty = _on ? static_cast<uint32_t>((_speedPct * 255) / 100) : 0;
    ledcWrite(TURBINE_LEDC_CH, duty);
#endif

    char buf[80];
    snprintf(buf, sizeof(buf), "Turbine: %s at %d%% speed", _on ? "ON" : "OFF", _speedPct);
    Logger::log(LogLevel::INFO, buf);
}

// ──────────────────────────────────────────────────────────
void Turbine::update(unsigned long now) {
    if ((now - _lastSample) < _SAMPLE_INTERVAL_MS) return;
    _lastSample = now;

    // Read ADC on PIN_TURBINE_VOLT (ADC1_CH6) with multi-sample smoothing
    uint32_t rawSum = 0;
    constexpr int SAMPLES = 8;
    for (int i = 0; i < SAMPLES; i++) {
        rawSum += analogRead(PIN_TURBINE_VOLT);
    }
    float rawAvg = static_cast<float>(rawSum) / SAMPLES;

    // Calculate sensed voltage from voltage divider (e.g. 10k/3.3k -> 4.03x)
    float sensedVolt = (rawAvg / 4095.0f) * 3.3f * TURBINE_VOLT_CAL_RATIO;

    // If hardware sense wire has active voltage (generator spun by water flow or motor rail)
    if (sensedVolt > 0.08f) {
        _voltage = sensedVolt;
    } else if (_on && _speedPct > 0) {
        // If powered via ESP32 PWM demo and sense pin is floating or unhooked,
        // estimate working voltage from PWM duty cycle (assuming standard 5V USB/rail)
        _voltage = (_speedPct / 100.0f) * 5.0f;
    } else {
        _voltage = 0.0f;
    }

    // Compute live metrics
    if (_voltage > 0.02f) {
        _currentMa = (_voltage / TURBINE_LOAD_RESISTOR) * 1000.0f;
        _powerMw   = _voltage * _currentMa;
        _rpm       = static_cast<int>(_voltage * 460.0f);
    } else {
        _voltage   = 0.0f;
        _currentMa = 0.0f;
        _powerMw   = 0.0f;
        _rpm       = 0;
    }
}
