/**
 * @file WebApi.cpp
 * @brief AquaGuard — Web API implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#ifndef NATIVE_UNIT_TEST
#include "WebApi.h"

// ──────────────────────────────────────────────────────────
WebApi::WebApi(SafetyManager& sm, WaterLevel& wl, GateFlow& gf,
               ServoGate& sg, Pumps& pumps, FireSensor& fire,
               GasSensor& gas, Ultrasonic& us, Turbine& turbine)
    : _sm(sm), _wl(wl), _gf(gf), _sg(sg), _pumps(pumps),
      _fire(fire), _gas(gas), _us(us), _turbine(turbine)
{}

// ──────────────────────────────────────────────────────────
void WebApi::begin() {
    // --- LittleFS ---
    if (!LittleFS.begin(true)) {
        Logger::log(LogLevel::CRITICAL, "LittleFS mount failed!");
    } else {
        Logger::log(LogLevel::INFO, "LittleFS mounted OK");
    }

    // --- mDNS ---
    if (MDNS.begin(MDNS_HOSTNAME)) {
        MDNS.addService("http", "tcp", 80);
        Logger::log(LogLevel::INFO, "mDNS: dam.local");
    }

    // --- DNS captive portal (redirect all queries to 192.168.4.1) ---
    _dns.start(53, "*", IPAddress(192, 168, 4, 1));

    // --- Setup server ---
    _setupStaticFiles();
    _setupRestApi();
    _setupWebSocket();

    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    _server.begin();

    Logger::log(LogLevel::INFO, "WebApi: HTTP server started on port 80");
}

// ──────────────────────────────────────────────────────────
void WebApi::processDNS() {
    _dns.processNextRequest();
}

// ──────────────────────────────────────────────────────────
void WebApi::update(unsigned long now) {
    _ws.cleanupClients();
    _recordHistory(now);

    if ((now - _lastPush) >= WS_PUSH_INTERVAL_MS) {
        _lastPush = now;
        _pushState();
    }
}

// ──────────────────────────────────────────────────────────
int WebApi::clientCount() const {
    return _ws.count();
}

// ──────────────────────────────────────────────────────────
void WebApi::_setupStaticFiles() {
    // Serve gzipped files from LittleFS
    _server.serveStatic("/", LittleFS, "/")
        .setDefaultFile("index.html")
        .setCacheControl("max-age=86400");

    // Captive portal redirects
    _server.onNotFound([](AsyncWebServerRequest* req) {
        req->redirect("http://192.168.4.1/");
    });
}

// ──────────────────────────────────────────────────────────
void WebApi::_setupWebSocket() {
    _ws.onEvent(_onWsEvent);
    _server.addHandler(&_ws);
}

// ──────────────────────────────────────────────────────────
void WebApi::_setupRestApi() {
    // GET /api/state
    _server.on("/api/state", HTTP_GET, [this](AsyncWebServerRequest* req) {
        req->send(200, "application/json", _buildStateJson());
    });

    // GET /api/log
    _server.on("/api/log", HTTP_GET, [this](AsyncWebServerRequest* req) {
        _handleLog(req);
    });

    // POST /api/ack
    _server.on("/api/ack", HTTP_POST, [this](AsyncWebServerRequest* req) {
        _handleAck(req);
    });

    // Body-bearing POST handlers
    auto bodyHandler = [this](AsyncWebServerRequest* req, uint8_t* data,
                               size_t len, size_t index, size_t total) {
        if (index + len == total) {
            // Full body received
            JsonDocument doc;
            DeserializationError err = deserializeJson(doc, data, len);
            if (err) {
                req->send(400, "application/json", "{\"error\":\"invalid json\"}");
                return;
            }
            String path = req->url();
            if (path == "/api/gate")           _handleGate(req, doc);
            else if (path == "/api/pump")      _handlePump(req, doc);
            else if (path == "/api/turbine")   _handleTurbine(req, doc);
            else if (path == "/api/mode")      _handleMode(req, doc);
            else if (path == "/api/settings")  _handleSettings(req, doc);
            else if (path == "/api/override")  _handleOverride(req, doc);
            else req->send(404);
        }
    };

    _server.on("/api/gate",     HTTP_POST, nullptr, nullptr, bodyHandler);
    _server.on("/api/pump",     HTTP_POST, nullptr, nullptr, bodyHandler);
    _server.on("/api/turbine",  HTTP_POST, nullptr, nullptr, bodyHandler);
    _server.on("/api/mode",     HTTP_POST, nullptr, nullptr, bodyHandler);
    _server.on("/api/settings", HTTP_POST, nullptr, nullptr, bodyHandler);
    _server.on("/api/override", HTTP_POST, nullptr, nullptr, bodyHandler);
}

// ──────────────────────────────────────────────────────────
void WebApi::_handleTurbine(AsyncWebServerRequest* req, JsonDocument& doc) {
    if (_rateLimit()) { req->send(429, "application/json", "{\"error\":\"rate limited\"}"); return; }
    bool on    = doc["on"]    | false;
    int  speed = doc["speed"] | 100;
    _turbine.setControl(on, speed);
    req->send(200, "application/json", "{\"ok\":true}");
}

// ──────────────────────────────────────────────────────────
void WebApi::_handleGate(AsyncWebServerRequest* req, JsonDocument& doc) {
    if (_rateLimit()) {
        req->send(429, "application/json", "{\"error\":\"rate limited\"}");
        return;
    }
    int angle = doc["angle"] | -1;
    if (angle < 0 || angle > 100) {
        req->send(400, "application/json", "{\"error\":\"angle must be 0-100\"}");
        return;
    }
    _sm.commandGate(angle);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handlePump(AsyncWebServerRequest* req, JsonDocument& doc) {
    if (_rateLimit()) { req->send(429, "application/json", "{\"error\":\"rate limited\"}"); return; }
    int  id    = doc["id"]    | 0;
    bool on    = doc["on"]    | false;
    int  speed = doc["speed"] | 100;
    if (id < 1 || id > 2) { req->send(400, "application/json", "{\"error\":\"id must be 1 or 2\"}"); return; }
    _pumps.setChannel(id, on, speed);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleMode(AsyncWebServerRequest* req, JsonDocument& doc) {
    if (_rateLimit()) { req->send(429, "application/json", "{\"error\":\"rate limited\"}"); return; }
    const char* mode = doc["mode"] | "auto";
    _sm.setMode(strcmp(mode, "manual") == 0 ? OperatingMode::MANUAL : OperatingMode::AUTO);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleSettings(AsyncWebServerRequest* req, JsonDocument& doc) {
    // TODO: persist to NVS in v1.1
    // For now, accept and ack
    Logger::log(LogLevel::INFO, "Settings update received (NVS persist TODO)");
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleOverride(AsyncWebServerRequest* req, JsonDocument& doc) {
    bool confirm = doc["confirm"] | false;
    if (!confirm) { req->send(400, "application/json", "{\"error\":\"confirm required\"}"); return; }
    _sm.overrideInterlock();
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleAck(AsyncWebServerRequest* req) {
    _sm.acknowledgeAlarms();
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleLog(AsyncWebServerRequest* req) {
    JsonDocument doc;
    JsonArray arr = doc["events"].to<JsonArray>();
    Logger::toJsonArray(arr);
    String out;
    serializeJson(doc, out);
    req->send(200, "application/json", out);
}

// ──────────────────────────────────────────────────────────
String WebApi::_buildStateJson() {
    JsonDocument doc;

    const WaterLevelState& wls = _wl.getState();
    doc["uptime"]     = millis() / 1000;
    doc["freeHeap"]   = ESP.getFreeHeap();
    doc["wsClients"]  = _ws.count();
    doc["mode"]       = (_sm.getMode() == OperatingMode::AUTO) ? "auto" : "manual";
    doc["status"]     = systemStatusStr(_sm.getStatus());
    doc["alarms"]     = _sm.getAlarms();
    doc["interlocked"]= _sm.isInterlocked();
    doc["muted"]      = _sm.isMuted();
    doc["fwVersion"]  = FW_VERSION;

    // Gate
    JsonObject gate = doc["gate"].to<JsonObject>();
    gate["target"] = _sg.getTargetAngle();
    gate["actual"] = static_cast<int>(_sg.getActualAngle());
    gate["moving"] = _sg.isMoving();
    gate["paused"] = _sg.isPaused();

    // Water level
    JsonObject level = doc["level"].to<JsonObject>();
    level["percent"] = wls.levelPercent;
    JsonObject wires = level["wires"].to<JsonObject>();
    wires["low"]     = wls.low;
    wires["medium"]  = wls.medium;
    wires["high"]    = wls.high;
    wires["warning"] = wls.warning;
    wires["flow"]    = _gf.isFlowWet();
    level["probeFault"] = wls.probeFault;

    // Gate flow
    JsonObject flow = doc["flow"].to<JsonObject>();
    flow["state"]     = flowStateStr(_gf.getState());
    flow["confirmMs"] = _gf.getConfirmMs();

    // Proximity
    JsonObject prox = doc["proximity"].to<JsonObject>();
    prox["distanceCm"] = _us.getDistanceCm();
    prox["zone"]       = proximityZoneStr(_us.getZone());

    // Pumps
    JsonArray pumps = doc["pumps"].to<JsonArray>();
    for (int i = 0; i < 2; i++) {
        const PumpState& ps = (i == 0) ? _pumps.getPump1() : _pumps.getPump2();
        JsonObject p = pumps.add<JsonObject>();
        p["id"]         = i + 1;
        p["on"]         = ps.on;
        p["speed"]      = ps.speedPct;
        p["dryWarning"] = ps.dryWarning;
        p["runtimeS"]   = ps.on && ps.startedAt > 0 ?
                          (unsigned long)((millis() - ps.startedAt) / 1000) : 0;
    }

    // Fire
    doc["fire"] = _fire.isFlameDetected();

    // Gas
    JsonObject gas = doc["gas"].to<JsonObject>();
    gas["raw"]     = _gas.getRawValue();
    gas["level"]   = gasLevelStr(_gas.getLevel());
    gas["warmupS"] = _gas.getWarmupSecondsRemaining();

    // Hydro-Electric Turbine Demo
    JsonObject turbine = doc["turbine"].to<JsonObject>();
    turbine["on"]        = _turbine.isOn();
    turbine["speed"]     = _turbine.getSpeed();
    turbine["voltage"]   = _turbine.getVoltage();
    turbine["currentMa"] = _turbine.getCurrentMa();
    turbine["powerMw"]   = _turbine.getPowerMw();
    turbine["rpm"]       = _turbine.getRpm();

    // Sensor Fault & Disconnection Diagnostics
    JsonObject sensors = doc["sensors"].to<JsonObject>();
    sensors["ultrasonicDisconnected"] = _us.isDisconnected();
    sensors["gasDisconnected"]        = _gas.isDisconnected();
    sensors["probeFault"]              = wls.probeFault;
    sensors["anyFault"]                = _us.isDisconnected() || _gas.isDisconnected() || wls.probeFault;

    // History
    JsonArray hist = doc["history"].to<JsonArray>();
    _historyToJson(hist);

    String out;
    serializeJson(doc, out);
    return out;
}

// ──────────────────────────────────────────────────────────
void WebApi::_pushState(bool force) {
    if (_ws.count() == 0) return;

    String json = _buildStateJson();
    if (!force && json == _lastJson) return;  // No change
    _lastJson = json;

    _ws.textAll(json);
}

// ──────────────────────────────────────────────────────────
void WebApi::_recordHistory(unsigned long now) {
    if ((now - _lastHistory) < HISTORY_INTERVAL_MS) return;
    _lastHistory = now;

    _history[_histHead] = { now, _wl.getState().levelPercent };
    _histHead = (_histHead + 1) % HISTORY_POINTS;
    if (_histCount < HISTORY_POINTS) _histCount++;
}

void WebApi::_historyToJson(JsonArray& arr) {
    for (int i = 0; i < _histCount; i++) {
        int idx = (_histHead - _histCount + i + HISTORY_POINTS * 2) % HISTORY_POINTS;
        JsonObject pt = arr.add<JsonObject>();
        pt["ts"]  = _history[idx].ts;
        pt["lvl"] = _history[idx].levelPct;
    }
}

// ──────────────────────────────────────────────────────────
bool WebApi::_rateLimit() {
    unsigned long now = millis();
    if ((now - _lastCmd) < CMD_RATE_LIMIT_MS) return true;
    _lastCmd = now;
    return false;
}

// ──────────────────────────────────────────────────────────
void WebApi::_onWsEvent(AsyncWebSocket* server, AsyncWebSocketClient* client,
                         AwsEventType type, void* arg, uint8_t* data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        char buf[60];
        snprintf(buf, sizeof(buf), "WS: client #%u connected", client->id());
        Logger::log(LogLevel::INFO, buf);
    } else if (type == WS_EVT_DISCONNECT) {
        char buf[60];
        snprintf(buf, sizeof(buf), "WS: client #%u disconnected", client->id());
        Logger::log(LogLevel::INFO, buf);
    }
    // Message handling delegated to next iteration of update()
}

void WebApi::_handleWsMessage(uint8_t* data, size_t len) {
    // WebSocket commands are handled via REST POST endpoints
    // WS is read-only push from server side
    (void)data; (void)len;
}

#endif // NATIVE_UNIT_TEST
