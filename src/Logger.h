/**
 * @file Logger.h
 * @brief AquaGuard — Event logger with ring buffer
 *
 * Provides a thread-safe 50-event ring buffer for system events.
 * Each entry has a timestamp, severity level, and message.
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#pragma once
#ifndef NATIVE_UNIT_TEST
  #include <Arduino.h>
  #include <ArduinoJson.h>
#else
  #include <string>
  #include <cstdint>
  using String = std::string;
#endif
#include "config.h"

/// Log severity levels
enum class LogLevel : uint8_t {
    INFO     = 0,
    WARNING  = 1,
    CRITICAL = 2,
    DEBUG    = 3
};

/// A single log entry
struct LogEntry {
    unsigned long timestamp_ms;   ///< millis() at time of log
    LogLevel      level;
    char          message[128];   ///< Fixed-size to avoid heap fragmentation
};

/**
 * @class Logger
 * @brief Static ring-buffer event logger
 *
 * Usage:
 *   Logger::log(LogLevel::INFO, "System started");
 *   Logger::log(LogLevel::CRITICAL, "Dam warning active");
 */
class Logger {
public:
    /// Initialise the logger (call once in setup)
    static void begin();

    /// Log a message at the given severity
    static void log(LogLevel level, const char* message);
    static void log(LogLevel level, const String& message);

#ifndef NATIVE_UNIT_TEST
    /// Serialise all entries into a JSON array (newest first)
    static void toJsonArray(JsonArray& arr);
#endif

    /// Return the current entry count (up to LOG_RING_SIZE)
    static int count();

    /// Return a pointer to entry at ring index i (0 = oldest)
    static const LogEntry* getEntry(int i);

    /// Clear all entries
    static void clear();

private:
    static LogEntry  _ring[LOG_RING_SIZE];
    static int       _head;   ///< Next write position
    static int       _count;  ///< Total entries stored (capped at LOG_RING_SIZE)
    static bool      _mutex;  ///< Simple spin-lock (single-core main loop only)
};
