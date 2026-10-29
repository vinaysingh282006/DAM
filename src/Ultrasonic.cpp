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
    if (cm <= 0) {
        // Invalid reading — don't change zone but accumulate clears
        _clearCounter++;
    } else if (cm <= PROX_WARN_CM) {
        _dangerCounter++;
        _warnCounter  = 0;
        _clearCounter = 0;
    } else if (cm <= PROX_CLEAR_CM) {
        _warnCounter++;
        _dangerCounter = 0;
        _clearCounter  = 0;
    } else {
        _clearCounter++;
        _warnCounter   = 0;
        _dangerCounter = 0;
    }

    ProximityZone newZone = _zone;

    switch (_zone) {
        case ProximityZone::CLEAR:
            if (_warnCounter  >= PROX_TRIGGER_COUNT) { newZone = ProximityZone::WARNING; _warnCounter  = 0; }
            if (_dangerCounter>= PROX_TRIGGER_COUNT) { newZone = ProximityZone::DANGER;  _dangerCounter= 0; }
            break;
        case ProximityZone::WARNING:
            if (_dangerCounter>= PROX_TRIGGER_COUNT) { newZone = ProximityZone::DANGER;  _dangerCounter= 0; }
            if (_clearCounter >= PROX_CLEAR_COUNT)   { newZone = ProximityZone::CLEAR;   _clearCounter = 0; }
            break;
        case ProximityZone::DANGER:
            if (_clearCounter >= PROX_CLEAR_COUNT)   { newZone = ProximityZone::CLEAR;   _clearCounter = 0; }
            break;
    }

    if (newZone != _zone) {
        _zone = newZone;
        char buf[80];
        snprintf(buf, sizeof(buf), "PROX %s: object at %.1f cm",
            proximityZoneStr(_zone), cm > 0 ? cm : 0.0f);
        LogLevel lvl = (_zone == ProximityZone::DANGER)  ? LogLevel::CRITICAL :
                       (_zone == ProximityZone::WARNING) ? LogLevel::WARNING  : LogLevel::INFO;
        Logger::log(lvl, buf);
    }
}
