/**
 * @file WebApi.cpp
 * @brief AquaGuard — Web API implementation
 *
 * @author  AquaGuard Project
 * @version 1.0.0
 */
#ifndef NATIVE_UNIT_TEST
#include "WebApi.h"

static WebApi* s_webApiInstance = nullptr;

// ──────────────────────────────────────────────────────────
WebApi::WebApi(SafetyManager& sm, WaterLevel& wl, GateFlow& gf,
               ServoGate& sg, Pumps& pumps, FireSensor& fire,
               GasSensor& gas, Ultrasonic& us, Turbine& turbine)
    : _sm(sm), _wl(wl), _gf(gf), _sg(sg), _pumps(pumps),
      _fire(fire), _gas(gas), _us(us), _turbine(turbine)
{
    s_webApiInstance = this;
}

// ──────────────────────────────────────────────────────────
void WebApi::begin() {
    s_webApiInstance = this;

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

    // --- Setup server (WS and API first so they take precedence over static files) ---
    _setupWebSocket();
    _setupRestApi();
    _setupStaticFiles();

    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    DefaultHeaders::Instance().addHeader("Pragma", "no-cache");
    DefaultHeaders::Instance().addHeader("Expires", "0");
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
    // Explicit root handler: serve with no-cache so client always gets latest UI
    _server.on("/", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (LittleFS.exists("/index.html")) {
            AsyncWebServerResponse *response = req->beginResponse(LittleFS, "/index.html", "text/html");
            response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            response->addHeader("Pragma", "no-cache");
            response->addHeader("Expires", "0");
            req->send(response);
        } else {
            String fallback = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>AquaGuard ESP32</title>"
                "<style>body{background:#0a0e1a;color:#a8e8ff;font-family:sans-serif;padding:24px;text-align:center;}"
                ".card{background:#171b28;border:1px solid #00d4ff;border-radius:12px;padding:24px;max-width:380px;margin:40px auto;box-shadow:0 0 20px rgba(0,212,255,0.2);}"
                "h1{font-size:22px;color:#00d4ff;margin-bottom:8px;}p{font-size:14px;color:#bbc9cf;line-height:1.6;}"
                ".badge{display:inline-block;padding:4px 10px;background:#003824;color:#4edea3;border-radius:20px;font-size:12px;margin-bottom:16px;font-weight:bold;}"
                "a{color:#00d4ff;text-decoration:none;font-weight:bold;display:inline-block;margin-top:16px;padding:10px 20px;background:#1b1f2c;border:1px solid #00d4ff;border-radius:8px;}</style></head>"
                "<body><div class='card'><span class='badge'>&#9679; ESP32 ONLINE</span><h1>AquaGuard SCADA</h1><p>Microcontroller firmware is active!</p>"
                "<p style='color:#ffd5d1'>Web assets missing from LittleFS. Please upload filesystem:<br><code style='color:#4edea3'>pio run --target uploadfs</code></p>"
                "<a href='/api/state'>View Live JSON Telemetry</a></div></body></html>";
            req->send(200, "text/html", fallback);
        }
    });

    _server.on("/index.html", HTTP_GET, [](AsyncWebServerRequest* req) {
        if (LittleFS.exists("/index.html")) {
            AsyncWebServerResponse *response = req->beginResponse(LittleFS, "/index.html", "text/html");
            response->addHeader("Cache-Control", "no-cache, no-store, must-revalidate");
            response->addHeader("Pragma", "no-cache");
            response->addHeader("Expires", "0");
            req->send(response);
        } else {
            req->redirect("http://192.168.4.1/");
        }
    });

    // Serve all static assets from LittleFS with no-cache so development changes apply immediately
    _server.serveStatic("/", LittleFS, "/")
        .setCacheControl("no-cache, no-store, must-revalidate");

    // Captive portal redirects
    _server.onNotFound([](AsyncWebServerRequest* req) {
        String url = req->url();
        if (url == "/" || url == "/index.html") {
            req->send(404, "text/plain", "Not Found");
            return;
        }
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
            if (len > 0) {
                DeserializationError err = deserializeJson(doc, data, len);
                if (err && !req->hasArg("angle") && !req->hasArg("id") && 
                    !req->hasArg("on") && !req->hasArg("mode")) {
                    req->send(400, "application/json", "{\"error\":\"invalid json\"}");
                    return;
                }
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

    auto onPost = [this](AsyncWebServerRequest* req) {
        // Only respond here if request has NO body, preventing duplicate response crash
        if (req->contentLength() == 0) {
            JsonDocument emptyDoc;
            String path = req->url();
            if (path == "/api/gate")           _handleGate(req, emptyDoc);
            else if (path == "/api/pump")      _handlePump(req, emptyDoc);
            else if (path == "/api/turbine")   _handleTurbine(req, emptyDoc);
            else if (path == "/api/mode")      _handleMode(req, emptyDoc);
            else if (path == "/api/settings")  _handleSettings(req, emptyDoc);
            else if (path == "/api/override")  _handleOverride(req, emptyDoc);
            else req->send(404);
        }
    };

    auto onGet = [this](AsyncWebServerRequest* req) {
        JsonDocument emptyDoc;
        String path = req->url();
        if (path == "/api/gate")           _handleGate(req, emptyDoc);
        else if (path == "/api/pump")      _handlePump(req, emptyDoc);
        else if (path == "/api/turbine")   _handleTurbine(req, emptyDoc);
        else if (path == "/api/mode")      _handleMode(req, emptyDoc);
        else if (path == "/api/settings")  _handleSettings(req, emptyDoc);
        else if (path == "/api/override")  _handleOverride(req, emptyDoc);
        else req->send(404);
    };

    _server.on("/api/gate",     HTTP_GET, onGet);
    _server.on("/api/pump",     HTTP_GET, onGet);
    _server.on("/api/turbine",  HTTP_GET, onGet);
    _server.on("/api/mode",     HTTP_GET, onGet);

    _server.on("/api/gate",     HTTP_POST, onPost, nullptr, bodyHandler);
    _server.on("/api/pump",     HTTP_POST, onPost, nullptr, bodyHandler);
    _server.on("/api/turbine",  HTTP_POST, onPost, nullptr, bodyHandler);
    _server.on("/api/mode",     HTTP_POST, onPost, nullptr, bodyHandler);
    _server.on("/api/settings", HTTP_POST, onPost, nullptr, bodyHandler);
    _server.on("/api/override", HTTP_POST, onPost, nullptr, bodyHandler);
}

// ──────────────────────────────────────────────────────────
void WebApi::_handleTurbine(AsyncWebServerRequest* req, JsonDocument& doc) {
    bool on = false;
    int  speed = 85;

    if (!doc["on"].isNull()) on = doc["on"].as<bool>();
    else if (req->hasArg("on")) on = (req->arg("on") == "true" || req->arg("on") == "1");

    if (!doc["speed"].isNull()) speed = doc["speed"].as<int>();
    else if (req->hasArg("speed")) speed = req->arg("speed").toInt();

    _sm.setMode(OperatingMode::MANUAL);
    if (on && speed <= 0) speed = 85;
    _turbine.setControl(on, speed);
    _pushState(true);
    req->send(200, "application/json", "{\"ok\":true}");
}

// ──────────────────────────────────────────────────────────
void WebApi::_handleGate(AsyncWebServerRequest* req, JsonDocument& doc) {
    int angle = -1;
    if (!doc["angle"].isNull()) angle = doc["angle"].as<int>();
    else if (req->hasArg("angle")) angle = req->arg("angle").toInt();

    if (angle < 0 || angle > 100) {
        req->send(400, "application/json", "{\"error\":\"angle must be 0-100\"}");
        return;
    }
    _sm.commandGate(angle);
    _pushState(true);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handlePump(AsyncWebServerRequest* req, JsonDocument& doc) {
    int  id      = 0;
    bool on      = false;
    int  speed   = 100;
    bool reverse = false;

    if (!doc["id"].isNull()) id = doc["id"].as<int>();
    else if (req->hasArg("id")) id = req->arg("id").toInt();

    if (!doc["on"].isNull()) on = doc["on"].as<bool>();
    else if (req->hasArg("on")) on = (req->arg("on") == "true" || req->arg("on") == "1");

    if (!doc["speed"].isNull()) speed = doc["speed"].as<int>();
    else if (req->hasArg("speed")) speed = req->arg("speed").toInt();

    if (!doc["reverse"].isNull()) reverse = doc["reverse"].as<bool>();
    else if (req->hasArg("reverse")) reverse = (req->arg("reverse") == "true" || req->arg("reverse") == "1");
    else if (req->hasArg("dir")) reverse = (req->arg("dir") == "reverse" || req->arg("dir") == "rev");
    else if (id == 1) reverse = _pumps.getPump1().reverse; // preserve current direction if not passed

    if (id < 1 || id > 2) { req->send(400, "application/json", "{\"error\":\"id must be 1 or 2\"}"); return; }

    _sm.setMode(OperatingMode::MANUAL);
    if (on && speed <= 0) speed = 100;
    _pumps.setChannel(id, on, speed, reverse);
    _pushState(true);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleMode(AsyncWebServerRequest* req, JsonDocument& doc) {
    String m = "manual";
    if (!doc["mode"].isNull()) m = doc["mode"].as<String>();
    else if (req->hasArg("mode")) m = req->arg("mode");

    _sm.setMode((m == "auto") ? OperatingMode::AUTO : OperatingMode::MANUAL);
    _pushState(true);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleSettings(AsyncWebServerRequest* req, JsonDocument& doc) {
    // Persist or accept
    Logger::log(LogLevel::INFO, "Settings update received");
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleOverride(AsyncWebServerRequest* req, JsonDocument& doc) {
    bool confirm = doc["confirm"] | false;
    if (!confirm) { req->send(400, "application/json", "{\"error\":\"confirm required\"}"); return; }
    _sm.overrideInterlock();
    _pushState(true);
    req->send(200, "application/json", "{\"ok\":true}");
}

void WebApi::_handleAck(AsyncWebServerRequest* req) {
    _sm.acknowledgeAlarms();
    _pushState(true);
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
        p["reverse"]    = ps.reverse;
        p["direction"]  = ps.reverse ? "REVERSE" : "FORWARD";
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
        // Push full state immediately so newly connected client populates instantly
        if (s_webApiInstance) {
            client->text(s_webApiInstance->_buildStateJson());
        }
    } else if (type == WS_EVT_DISCONNECT) {
        char buf[60];
        snprintf(buf, sizeof(buf), "WS: client #%u disconnected", client->id());
        Logger::log(LogLevel::INFO, buf);
    } else if (type == WS_EVT_DATA) {
        AwsFrameInfo* info = (AwsFrameInfo*)arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
            if (s_webApiInstance) {
                s_webApiInstance->_handleWsMessage(data, len);
            }
        }
    }
}

void WebApi::_handleWsMessage(uint8_t* data, size_t len) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, data, len);
    if (err) return;

    const char* cmd = doc["cmd"] | "";
    if (strcmp(cmd, "mode") == 0) {
        const char* m = doc["mode"] | "manual";
        _sm.setMode(strcmp(m, "auto") == 0 ? OperatingMode::AUTO : OperatingMode::MANUAL);
        _pushState(true);
    } else if (strcmp(cmd, "gate") == 0) {
        int angle = doc["angle"] | -1;
        if (angle >= 0 && angle <= 100) {
            _sm.commandGate(angle);
            _pushState(true);
        }
    } else if (strcmp(cmd, "pump") == 0) {
        int id = doc["id"] | 0;
        bool on = doc["on"] | false;
        int speed = doc["speed"] | 100;
        bool reverse = doc["reverse"] | (id == 1 ? _pumps.getPump1().reverse : false);
        if (id >= 1 && id <= 2) {
            _sm.setMode(OperatingMode::MANUAL);
            if (on && speed <= 0) speed = 100;
            _pumps.setChannel(id, on, speed, reverse);
            _pushState(true);
        }
    } else if (strcmp(cmd, "turbine") == 0) {
        bool on = doc["on"] | false;
        int speed = doc["speed"] | 85;
        _sm.setMode(OperatingMode::MANUAL);
        if (on && speed <= 0) speed = 85;
        _turbine.setControl(on, speed);
        _pushState(true);
    } else if (strcmp(cmd, "override") == 0) {
        bool confirm = doc["confirm"] | false;
        if (confirm) {
            _sm.overrideInterlock();
            _pushState(true);
        }
    } else if (strcmp(cmd, "ack") == 0) {
        _sm.acknowledgeAlarms();
        _pushState(true);
    }
}

#endif // NATIVE_UNIT_TEST
