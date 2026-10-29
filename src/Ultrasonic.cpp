/**
 * @file Ultrasonic.cpp
 * @brief AquaGuard — HC-SR04 proximity sensor implementation
 *
 * Uses pulseIn() for echo reading — brief blocking (~30ms max).
 * Between readings the loop is fully free.
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "Ultrasonic.h"
#include "Logger.h"
#include <algorithm>   // std::sort for median

// ──────────────────────────────────────────────────────────
void Ultrasonic::begin() {
    pinMode(PIN_TRIG, OUTPUT);
    pinMode(PIN_ECHO, INPUT);
    digitalWrite(PIN_TRIG, LOW);

    _usState      = USState::IDLE;
    _distanceCm   = -1.0f;
    _sampleIdx    = 0;
    _sampleCount  = 0;
    _zone         = ProximityZone::CLEAR;
    _warnCounter  = 0;
    _dangerCounter= 0;
    _clearCounter = 0;
    _lastReading  = 0;

    Logger::log(LogLevel::INFO, "Ultrasonic: initialised (gate proximity)");
}

// ──────────────────────────────────────────────────────────
void Ultrasonic::update(unsigned long now) {
    // Only take a new reading every PROX_INTERVAL_MS
    if ((now - _lastReading) < PROX_INTERVAL_MS) return;
    _lastReading = now;

    // --- Trigger the sensor ---
    digitalWrite(PIN_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_TRIG, LOW);

    // --- Read echo (blocking, max 30ms timeout) ---
    unsigned long duration = pulseIn(PIN_ECHO, HIGH, 30000UL);

    float cm = -1.0f;
    if (duration > 0) {
        // Speed of sound 343 m/s; round-trip ÷ 2; convert µs → cm
        cm = (duration / 58.0f);
        _zeroEchoCount = 0;
        _disconnected = false;
    } else {
        _zeroEchoCount++;
        if (_zeroEchoCount >= US_DISCONNECT_ZERO_COUNT) {
            _disconnected = true;
        }
    }

    // Ignore out-of-range values
    if (cm > PROX_MAX_VALID_CM || cm < PROX_MIN_VALID_CM) {
        cm = -1.0f;
    }


    // --- Add to sample buffer ---
    _samples[_sampleIdx] = cm;
    _sampleIdx = (_sampleIdx + 1) % PROX_SAMPLES;
    if (_sampleCount < PROX_SAMPLES) _sampleCount++;

    // --- Compute median ---
    if (_sampleCount >= PROX_SAMPLES) {
        _distanceCm = _medianFilter();
    } else if (cm > 0) {
        _distanceCm = cm;   // Use raw until buffer is full
    }

    _updateZone(_distanceCm);
}

// ──────────────────────────────────────────────────────────
float Ultrasonic::_medianFilter() {
    float sorted[PROX_SAMPLES];
    int   validCount = 0;
    for (int i = 0; i < PROX_SAMPLES; i++) {
        if (_samples[i] > 0) sorted[validCount++] = _samples[i];
    }
    if (validCount == 0) return -1.0f;
    std::sort(sorted, sorted + validCount);
    return sorted[validCount / 2];
}

// ──────────────────────────────────────────────────────────
void Ultrasonic::_updateZone(float cm) {
    // HC-SR04 on GPIO 32/33 is dedicated to reservoir water level measurement.
    // Proximity zone is maintained CLEAR so water surface never blocks gate movement.
    _zone          = ProximityZone::CLEAR;
    _dangerCounter = 0;
    _warnCounter   = 0;
    _clearCounter  = 0;
}
