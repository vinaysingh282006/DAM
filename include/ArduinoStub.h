/**
 * @file ArduinoStub.h
 * @brief Minimal Arduino emulation stubs for native host compilation and unit tests
 */
#pragma once
#ifdef NATIVE_UNIT_TEST

#include <cstdint>
#include <cstdio>
#include <string>
#include <algorithm>

#define HIGH         1
#define LOW          0
#define INPUT        0x00
#define OUTPUT       0x01
#define INPUT_PULLUP 0x02

// Mock pin state table for testing
inline uint8_t mockPinStates[40] = {0};

inline void pinMode(uint8_t pin, uint8_t mode) { (void)pin; (void)mode; }
inline void digitalWrite(uint8_t pin, uint8_t val) { if (pin < 40) mockPinStates[pin] = val; }
inline int  digitalRead(uint8_t pin) { return (pin < 40) ? mockPinStates[pin] : 0; }
inline int  analogRead(uint8_t pin) { (void)pin; return 0; }

inline unsigned long millis() { return 0; }
inline unsigned long micros() { return 0; }
inline void delay(unsigned long ms) { (void)ms; }
inline void delayMicroseconds(unsigned int us) { (void)us; }
inline unsigned long pulseIn(uint8_t pin, uint8_t state, unsigned long timeout = 1000000L) {
    (void)pin; (void)state; (void)timeout; return 0;
}

inline void ledcSetup(uint8_t ch, uint32_t freq, uint8_t res) { (void)ch; (void)freq; (void)res; }
inline void ledcAttachPin(uint8_t pin, uint8_t ch) { (void)pin; (void)ch; }
inline void ledcWrite(uint8_t ch, uint32_t duty) { (void)ch; (void)duty; }
inline void ledcWriteTone(uint8_t ch, uint32_t freq) { (void)ch; (void)freq; }

// Utility helpers provided by Arduino.h
template<typename T>
inline T constrain(T amt, T low, T high) {
    return (amt < low) ? low : ((amt > high) ? high : amt);
}

#ifndef min
#define min(a,b) ((a)<(b)?(a):(b))
#endif

#ifndef max
#define max(a,b) ((a)>(b)?(a):(b))
#endif

#endif // NATIVE_UNIT_TEST
