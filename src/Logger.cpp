/**
 * @file Logger.cpp
 * @brief AquaGuard — Event logger implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#include "Logger.h"
#include <string.h>
#include <stdio.h>

// ── Static member definitions ──────────────────────────────
LogEntry Logger::_ring[LOG_RING_SIZE];
int      Logger::_head  = 0;
int      Logger::_count = 0;
bool     Logger::_mutex = false;

// ──────────────────────────────────────────────────────────
void Logger::begin() {
    _head  = 0;
    _count = 0;
    _mutex = false;
    log(LogLevel::INFO, "Logger initialised");
}

// ──────────────────────────────────────────────────────────
void Logger::log(LogLevel level, const char* message) {
    // Spin-lock (safe on single-core Arduino loop)
    while (_mutex) {}
    _mutex = true;

    LogEntry& e = _ring[_head];
#ifndef NATIVE_UNIT_TEST
    e.timestamp_ms = millis();
#else
    e.timestamp_ms = 0;
#endif
    e.level = level;
    strncpy(e.message, message, sizeof(e.message) - 1);
    e.message[sizeof(e.message) - 1] = '\0';

    _head = (_head + 1) % LOG_RING_SIZE;
    if (_count < LOG_RING_SIZE) _count++;

    _mutex = false;

#ifndef NATIVE_UNIT_TEST
    // Also print to serial for debugging
    const char* prefix = (level == LogLevel::CRITICAL) ? "[CRIT] " :
                         (level == LogLevel::WARNING)  ? "[WARN] " :
                         (level == LogLevel::DEBUG)    ? "[DBG ] " : "[INFO] ";
    Serial.print(prefix);
    Serial.println(message);
#endif
}

// ──────────────────────────────────────────────────────────
void Logger::log(LogLevel level, const String& message) {
    log(level, message.c_str());
}

// ──────────────────────────────────────────────────────────
#ifndef NATIVE_UNIT_TEST
void Logger::toJsonArray(JsonArray& arr) {
    // Return newest-first: iterate backwards from _head
    for (int i = 0; i < _count; i++) {
        int idx = (_head - 1 - i + LOG_RING_SIZE) % LOG_RING_SIZE;
        const LogEntry& e = _ring[idx];
        JsonObject obj    = arr.add<JsonObject>();
        obj["ts"]  = e.timestamp_ms;
        obj["lvl"] = static_cast<uint8_t>(e.level);
        obj["msg"] = e.message;
    }
}
#endif

// ──────────────────────────────────────────────────────────
int Logger::count() { return _count; }

const LogEntry* Logger::getEntry(int i) {
    if (i < 0 || i >= _count) return nullptr;
    // i=0 is oldest; map to ring position
    int idx = (_head - _count + i + LOG_RING_SIZE * 2) % LOG_RING_SIZE;
    return &_ring[idx];
}

void Logger::clear() {
    _head  = 0;
    _count = 0;
}
