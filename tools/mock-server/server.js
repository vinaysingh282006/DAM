/**
 * AquaGuard — Zero-Dependency Mock Server & Dev Environment
 * Uses native Node.js (http + crypto + fs + path)
 * Serves /data static assets and provides a real-time WebSocket telemetry feed
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const DATA_DIR = path.resolve(__dirname, '../../data');

// ── State Definition ─────────────────────────────────────────
const state = {
  uptime: 0,
  freeHeap: 214580,
  wsClients: 0,
  mode: 'auto',
  status: 'SAFE',
  alarms: [],
  interlocked: false,
  muted: false,
  fwVersion: '1.0.0',
  gate: {
    target: 0,
    actual: 0,
    moving: false,
    paused: false
  },
  level: {
    percent: 25,
    wires: {
      low: true,
      medium: false,
      high: false,
      warning: false,
      flow: false
    },
    probeFault: false
  },
  flow: {
    state: 'CLOSED',
    confirmMs: 0
  },
  proximity: {
    distanceCm: 52.4,
    zone: 'CLEAR'
  },
  pumps: [
    { id: 1, on: false, speed: 100, dryWarning: false, runtimeS: 0 },
    { id: 2, on: false, speed: 100, dryWarning: false, runtimeS: 0 }
  ],
  fire: false,
  gas: {
    raw: 410,
    level: 'NORMAL',
    warmupS: 0
  },
  turbine: {
    on: false,
    speed: 0,
    voltage: 0.0,
    currentMa: 0.0,
    powerMw: 0.0,
    rpm: 0
  },
  sensors: {
    ultrasonicDisconnected: false,
    gasDisconnected: false,
    probeFault: false,
    anyFault: false
  },
  history: [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25]
};

const events = [
  { ts: Math.floor(Date.now() / 1000) - 120, level: 1, msg: 'System booted. WiFi AP started: AquaGuard-Dam' },
  { ts: Math.floor(Date.now() / 1000) - 110, level: 1, msg: 'Sensors online. Low wire wet (25% capacity)' }
];

// ── WebSocket Clients List ───────────────────────────────────
const wsClients = new Set();

function sendWsFrame(socket, payloadStr) {
  const payloadBuf = Buffer.from(payloadStr, 'utf8');
  const len = payloadBuf.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  socket.write(Buffer.concat([header, payloadBuf]));
}

function broadcastState() {
  state.wsClients = wsClients.size;
  const jsonStr = JSON.stringify(state);
  for (const client of wsClients) {
    try {
      sendWsFrame(client, jsonStr);
    } catch (e) {
      wsClients.delete(client);
    }
  }
}

// ── Simulation Engine ────────────────────────────────────────
setInterval(() => {
  state.uptime++;

  // 1. Move gate smoothly toward target
  if (state.gate.actual !== state.gate.target) {
    state.gate.moving = true;
    const diff = state.gate.target - state.gate.actual;
    const step = 4; // ~8 deg/sec at 500ms tick
    if (Math.abs(diff) <= step) {
      state.gate.actual = state.gate.target;
      state.gate.moving = false;
    } else {
      state.gate.actual += Math.sign(diff) * step;
    }
  } else {
    state.gate.moving = false;
  }

  // 2. Gate flow state logic
  if (state.gate.actual > 10) {
    state.flow.state = 'FLOW_CONFIRMED';
    state.level.wires.flow = true;
    state.flow.confirmMs = 1200;
  } else {
    state.flow.state = 'CLOSED';
    state.level.wires.flow = false;
    state.flow.confirmMs = 0;
  }

  // 3. Proximity interlock logic
  if (state.proximity.distanceCm < 15) {
    state.proximity.zone = 'DANGER';
    state.interlocked = true;
  } else if (state.proximity.distanceCm < 40) {
    state.proximity.zone = 'WARNING';
    state.interlocked = true;
  } else {
    state.proximity.zone = 'CLEAR';
    state.interlocked = false;
  }

  // 4. Safety status aggregation
  state.alarms = [];
  if (state.level.wires.warning) {
    state.alarms.push('DAM_WATER_WARNING');
    state.status = 'CRITICAL';
    // Emergency auto open gate in auto mode
    if (state.mode === 'auto') {
      state.gate.target = 100;
    }
  } else if (state.fire) {
    state.alarms.push('FIRE_DETECTED');
    state.status = 'CRITICAL';
  } else if (state.gas.level === 'DANGER') {
    state.alarms.push('TOXIC_GAS_DANGER');
    state.status = 'CRITICAL';
  } else if (state.proximity.zone === 'DANGER') {
    state.alarms.push('GATE_PROXIMITY_HAZARD');
    state.status = 'WARNING';
  } else if (state.gas.level === 'WARNING') {
    state.alarms.push('GAS_ELEVATED');
    state.status = 'WARNING';
  } else if (state.sensors.anyFault) {
    state.alarms.push('SENSOR_HARDWARE_FAULT');
    state.status = 'CRITICAL';
  } else if (state.proximity.zone !== 'CLEAR') {
    state.alarms.push('PROX_AUTO_WARNING');
    state.status = 'WARNING';
  } else if (state.level.percent >= 75) {
    state.status = 'WARNING';
  } else {
    state.status = 'SAFE';
  }

  // 5. Turbine simulation
  if (state.turbine.on && state.turbine.speed > 0) {
    const jitter = (Math.random() * 0.08 - 0.04);
    state.turbine.voltage = parseFloat(Math.max(0, ((state.turbine.speed / 100) * 4.95 + jitter)).toFixed(2));
    state.turbine.currentMa = parseFloat(((state.turbine.voltage / 30.0) * 1000).toFixed(1));
    state.turbine.powerMw = parseFloat((state.turbine.voltage * state.turbine.currentMa).toFixed(1));
    state.turbine.rpm = Math.round(state.turbine.voltage * 460);
  } else {
    state.turbine.voltage = 0.0;
    state.turbine.currentMa = 0.0;
    state.turbine.powerMw = 0.0;
    state.turbine.rpm = 0;
  }

  // 6. Update pumps runtime
  state.pumps.forEach(p => {
    if (p.on) p.runtimeS++;
  });

  // 7. Record water history (last 60 points)
  if (state.uptime % 5 === 0) {
    state.history.push(state.level.percent);
    if (state.history.length > 60) state.history.shift();
  }

  broadcastState();
}, 500);

// ── HTTP Static File & REST Server ───────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // ── REST API Endpoints ─────────────────────────────────────
  if (pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(state));
  }

  if (pathname === '/api/log' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ events }));
  }

  if (pathname === '/api/gate' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const target = Math.max(0, Math.min(100, parseInt(payload.angle, 10) || 0));
        if (state.interlocked && !payload.override) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Gate interlocked: obstacle near gate' }));
        }
        state.gate.target = target;
        events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: `Gate angle set to ${target}°` });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, target }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    return;
  }

  if (pathname === '/api/pump' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const p = state.pumps.find(x => x.id === payload.id);
        if (p) {
          p.on = !!payload.on;
          if (payload.speed !== undefined) p.speed = parseInt(payload.speed, 10);
          events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: `Pump ${payload.id} turned ${p.on ? 'ON (' + p.speed + '%)' : 'OFF'}` });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end('{}');
      }
    });
    return;
  }

  if (pathname === '/api/turbine' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        state.turbine.on = !!payload.on;
        if (payload.speed !== undefined) state.turbine.speed = parseInt(payload.speed, 10);
        events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: `Hydro-Turbine Demo: turned ${state.turbine.on ? 'ON (' + state.turbine.speed + '%)' : 'OFF'}` });
        broadcastState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, turbine: state.turbine }));
      } catch (e) {
        res.writeHead(400);
        res.end('{}');
      }
    });
    return;
  }

  if (pathname === '/api/mode' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.mode === 'auto' || payload.mode === 'manual') {
          state.mode = payload.mode;
          events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: `Operating mode changed to ${payload.mode.toUpperCase()}` });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, mode: state.mode }));
      } catch (e) {
        res.writeHead(400);
        res.end('{}');
      }
    });
    return;
  }

  if (pathname === '/api/override' && req.method === 'POST') {
    state.interlocked = false;
    events.push({ ts: Math.floor(Date.now() / 1000), level: 2, msg: 'Safety interlock manually overridden by operator' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  if (pathname === '/api/ack' && req.method === 'POST') {
    events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'Operator acknowledged alarms' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // ── Interactive Simulation Trigger Endpoint ────────────────
  if (pathname === '/mock/scenario') {
    const sc = parsedUrl.searchParams.get('type');
    if (sc === 'rise') {
      state.level.percent = 100;
      state.level.wires = { low: true, medium: true, high: true, warning: true, flow: false };
      events.push({ ts: Math.floor(Date.now() / 1000), level: 3, msg: 'CRITICAL: Water reached DAM WARNING wire!' });
    } else if (sc === 'drain') {
      state.level.percent = 25;
      state.level.wires = { low: true, medium: false, high: false, warning: false, flow: false };
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'Reservoir drained to safe level (25%)' });
    } else if (sc === 'prox_near') {
      state.proximity.distanceCm = 8.2;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 2, msg: 'HC-SR04: Obstacle detected within 8 cm of gate!' });
    } else if (sc === 'prox_clear') {
      state.proximity.distanceCm = 55.0;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'HC-SR04: Gate proximity zone cleared' });
    } else if (sc === 'gas_spike') {
      state.gas.raw = 3150;
      state.gas.level = 'DANGER';
      events.push({ ts: Math.floor(Date.now() / 1000), level: 3, msg: 'MQ-135: Toxic gas spike detected (3150 ADC)!' });
    } else if (sc === 'gas_normal') {
      state.gas.raw = 430;
      state.gas.level = 'NORMAL';
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'MQ-135: Gas reading returned to normal baseline' });
    } else if (sc === 'flame_trigger') {
      state.fire = true;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 3, msg: 'Flame sensor triggered! Fire detected!' });
    } else if (sc === 'flame_clear') {
      state.fire = false;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'Flame cleared' });
    } else if (sc === 'disconnect_us') {
      state.sensors.ultrasonicDisconnected = true;
      state.sensors.anyFault = true;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 3, msg: 'ERROR: HC-SR04 Ultrasonic sensor disconnected / no echo!' });
    } else if (sc === 'connect_us') {
      state.sensors.ultrasonicDisconnected = false;
      state.sensors.anyFault = state.sensors.gasDisconnected || state.sensors.probeFault;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'HC-SR04 Ultrasonic sensor reconnected' });
    } else if (sc === 'disconnect_gas') {
      state.sensors.gasDisconnected = true;
      state.sensors.anyFault = true;
      state.gas.level = 'DISCONNECTED';
      state.gas.raw = 0;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 3, msg: 'ERROR: MQ-135 Gas sensor disconnected / open circuit!' });
    } else if (sc === 'connect_gas') {
      state.sensors.gasDisconnected = false;
      state.sensors.anyFault = state.sensors.ultrasonicDisconnected || state.sensors.probeFault;
      state.gas.level = 'NORMAL';
      state.gas.raw = 430;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'MQ-135 Gas sensor reconnected' });
    } else if (sc === 'turbine_toggle') {
      state.turbine.on = !state.turbine.on;
      state.turbine.speed = state.turbine.on ? 85 : 0;
      events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: `Turbine toggled ${state.turbine.on ? 'ON' : 'OFF'}` });
    }
    broadcastState();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, scenario: sc }));
  }

  // ── Static Asset Serving (/data) ───────────────────────────
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';

  const fullPath = path.join(DATA_DIR, safePath);

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    // SPA fallback: redirect to /index.html
    const indexPath = path.join(DATA_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(indexPath).pipe(res);
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(fullPath).pipe(res);
});

// ── WebSocket Upgrade Handshake ──────────────────────────────
server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request');
    return;
  }

  const key = req.headers['sec-websocket-key'];
  const hash = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${hash}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');
  wsClients.add(socket);
  state.wsClients = wsClients.size;
  console.log(`[WS] Client connected. Total: ${wsClients.size}`);

  // Send current state immediately on connection
  sendWsFrame(socket, JSON.stringify(state));

  socket.on('data', buffer => {
    // Minimal unmasking for incoming client text frame
    if (buffer.length < 6) return;
    const isMasked = (buffer[1] & 0x80) !== 0;
    let payloadLen = buffer[1] & 0x7F;
    let offset = 2;
    if (payloadLen === 126) offset += 2;
    else if (payloadLen === 127) offset += 8;

    if (isMasked) {
      const mask = buffer.slice(offset, offset + 4);
      offset += 4;
      const data = buffer.slice(offset);
      const unmasked = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) {
        unmasked[i] = data[i] ^ mask[i % 4];
      }
      try {
        const msg = JSON.parse(unmasked.toString('utf8'));
        console.log('[WS Command Received]:', msg);
        if (msg.cmd === 'gate' && msg.angle !== undefined) {
          state.gate.target = Math.max(0, Math.min(100, msg.angle));
        } else if (msg.cmd === 'pump' && msg.id !== undefined) {
          const p = state.pumps.find(x => x.id === msg.id);
          if (p) {
            p.on = !!msg.on;
            if (msg.speed !== undefined) p.speed = msg.speed;
          }
        } else if (msg.cmd === 'mode' && msg.mode) {
          state.mode = msg.mode;
        } else if (msg.cmd === 'ack') {
          events.push({ ts: Math.floor(Date.now() / 1000), level: 1, msg: 'Operator acknowledged alarms' });
        }
        broadcastState();
      } catch (err) {}
    }
  });

  socket.on('close', () => {
    wsClients.delete(socket);
    state.wsClients = wsClients.size;
    console.log(`[WS] Client disconnected. Total: ${wsClients.size}`);
  });

  socket.on('error', () => {
    wsClients.delete(socket);
    state.wsClients = wsClients.size;
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` AquaGuard Dam Mock Server running!`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`=======================================================`);
});
