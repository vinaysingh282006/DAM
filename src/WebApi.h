/**
 * @file WebApi.h
 * @brief AquaGuard — ESPAsyncWebServer REST + WebSocket API
 *
 * Serves the web dashboard from LittleFS (gzipped files).
 * Provides:
 *  - WebSocket /ws — full state JSON every 500ms or on change
 *  - GET  /api/state
 *  - POST /api/gate     {angle}
 *  - POST /api/pump     {id, on, speed}
 *  - POST /api/mode     {mode: "auto"|"manual"}
 *  - POST /api/settings {key, value}
 *  - POST /api/override {confirm}
 *  - POST /api/ack
 *  - GET  /api/log
 *  - POST /api/calibrate
 *
 * Captive portal: DNSServer redirects all DNS to 192.168.4.1.
 * mDNS: resolves as dam.local.
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#pragma once
#ifndef NATIVE_UNIT_TEST
#include <Arduino.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include "config.h"
#include "SafetyManager.h"
#include "WaterLevel.h"
#include "GateFlow.h"
#include "ServoGate.h"
#include "Pumps.h"
#include "FireSensor.h"
#include "GasSensor.h"
#include "Ultrasonic.h"
#include "Turbine.h"
#include "Logger.h"

// History data point
struct HistoryPoint {
    unsigned long ts;
    int levelPct;
};

/**
 * @class WebApi
 * @brief Async web server wrapping REST + WebSocket + captive portal
 */
class WebApi {
public:
    WebApi(SafetyManager& sm, WaterLevel& wl, GateFlow& gf,
           ServoGate& sg, Pumps& pumps, FireSensor& fire,
           GasSensor& gas, Ultrasonic& us, Turbine& turbine);

    /// Call once in setup() after WiFi AP is up
    void begin();

    /**
     * @brief Periodic tasks: push WS state, cleanup clients, record history.
     * @param now  Current millis()
     * Call every loop().
     */
    void update(unsigned long now);

    /// Process DNS requests (call every loop())
    void processDNS();

    /// Number of connected WebSocket clients
    int clientCount() const;

private:
    SafetyManager& _sm;
    WaterLevel&    _wl;
    GateFlow&      _gf;
    ServoGate&     _sg;
    Pumps&         _pumps;
    FireSensor&    _fire;
    GasSensor&     _gas;
    Ultrasonic&    _us;
    Turbine&       _turbine;

    AsyncWebServer _server{80};
    AsyncWebSocket _ws{"/ws"};
    DNSServer      _dns;

    // Rate limiting
    unsigned long  _lastCmd     = 0;

    // WS push timing
    unsigned long  _lastPush    = 0;
    String         _lastJson    = "";

    // History ring buffer
    HistoryPoint   _history[HISTORY_POINTS];
    int            _histHead    = 0;
    int            _histCount   = 0;
    unsigned long  _lastHistory = 0;

    // ── Setup helpers ──────────────────────────────────────
    void _setupStaticFiles();
    void _setupRestApi();
    void _setupWebSocket();

    // ── State serialisation ────────────────────────────────
    String _buildStateJson();
    void   _pushState(bool force = false);

    // ── REST handlers ──────────────────────────────────────
    void _handleGate    (AsyncWebServerRequest* req, JsonDocument& doc);
    void _handlePump    (AsyncWebServerRequest* req, JsonDocument& doc);
    void _handleTurbine (AsyncWebServerRequest* req, JsonDocument& doc);
    void _handleMode    (AsyncWebServerRequest* req, JsonDocument& doc);
    void _handleSettings(AsyncWebServerRequest* req, JsonDocument& doc);
    void _handleOverride(AsyncWebServerRequest* req, JsonDocument& doc);
    void _handleAck     (AsyncWebServerRequest* req);
    void _handleLog     (AsyncWebServerRequest* req);

    // ── WebSocket event handler ────────────────────────────
    static void _onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
                           AwsEventType type, void* arg, uint8_t* data, size_t len);
    void _handleWsMessage(uint8_t* data, size_t len);

    // ── Helpers ────────────────────────────────────────────
    bool _rateLimit();
    void _recordHistory(unsigned long now);
    void _historyToJson(JsonArray& arr);
};

#endif // NATIVE_UNIT_TEST
