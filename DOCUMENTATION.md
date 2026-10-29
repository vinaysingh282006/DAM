# AquaGuard Dam Control — Comprehensive System Engineering & Technical Documentation

> **Project:** Smart Miniature Dam Control & Automated Spillway System  
> **Target Platform:** Espressif ESP32 DevKit-V1 (Dual-Core Tensilica Xtensa @ 240MHz)  
> **Firmware Framework:** PlatformIO / Arduino C++ (FreeRTOS)  
> **Web Stack:** ESPAsyncWebServer + WebSockets (`/ws`) + LittleFS + Vanilla SPA (HTML5/CSS3/ES6)  
> **Key Hardware Focus:** MQ-135 Gas Sensor, HC-SR04 Ultrasonic Sensor, SG90 Micro Servo, Conductivity Wires, L298N Motor Driver

---

## 1. System Overview & Architecture

The **AquaGuard** system is a miniature smart dam prototype engineered for flood prevention, downstream hazard mitigation, gate safety interlocking, and hazardous gas/fire monitoring.

```
                           ┌────────────────────────┐
                           │   5V Power Supply      │ (2A - 3A)
                           └───┬────────────────┬───┘
                               │ 5V             │ 5V
                               ▼                ▼
   ┌───────────────────────┐ ┌───────────────┐ ┌───────────────────┐
   │  ESP32 DevKit-V1      │ │ SG90 Servo    │ │ HC-SR04 / MQ-135  │
   │  3.3V Logic Rail      │ │ (Spillway)    │ │ Sensors           │
   └───────────┬───────────┘ └───────▲───────┘ └─────────▲─────────┘
               │                     │ PWM (GPIO 18)     │
               ├─────────────────────┴───────────────────┤ (Echo via 1k/2k Divider)
               │                                         │ (AO via Divider / Clamped)
               │ Common Ground (GND)                     │
               ▼                                         ▼
   ┌───────────────────────┐                   ┌───────────────────┐
   │ Water Level Wires     │                   │ L298N Dual Pumps  │
   │ (LOW, MED, HIGH, WARN)│                   │ (Inlet & Outlet)  │
   └───────────────────────┘                   └───────────────────┘
```

The system operates across three coordinated layers:
1. **Physical Sensing & Actuation Layer:** Non-blocking hardware polling of water conductivity wires, ultrasonic time-of-flight distance, toxic gas concentrations, flame detection, dual DC pumps, and micro servo gate actuation.
2. **Embedded Logic & Safety Layer:** State machines evaluating flood thresholds, personnel safety interlocks, tailrace water flow confirmation, buzzer frequencies, and watchdog monitoring.
3. **Real-Time Web Application Layer:** A responsive web dashboard hosted from ESP32 LittleFS flash memory and streamed over an asynchronous WebSocket connection at 500 ms intervals.

---

## 2. Deep Dive: Key Sensor & Actuator Hardware

---

### 2.1. MQ-135 Hazardous Gas & Air Quality Sensor

```
          MQ-135 Pinout (Front View)
             ┌────────────────┐
             │   [ Sensor ]   │  <-- SnO2 Sensing Mesh
             │    (Heating)   │
             ├────────────────┤
             │ VCC  GND DO  AO│
             └──┬────┬───┬───┬┘
                │    │   │   │
                │    │   │   └─► Analog Out (0-5V) --> 1kΩ/2kΩ Divider --> ESP32 GPIO 35
                │    │   └─────► Digital Out (TTL Comparator - Unused or Secondary)
                │    └─────────► Ground (Common GND)
                └──────────────► +5V DC (DO NOT connect to 3.3V!)
```

#### Working Principle & Physics
The MQ-135 uses a ceramic micro-tube with a surface layer of **Tin Dioxide ($SnO_2$)**. In clean air, oxygen atoms adsorb onto the crystal surface of $SnO_2$, trapping free electrons and forming a high potential energy barrier (yielding high surface resistance $R_s$).
When reducing or oxidizing gases (such as Ammonia $NH_3$, Carbon Dioxide $CO_2$, Nitrogen Oxides $NO_x$, Alcohol, Benzene, and Smoke) contact the heated surface, they chemically react with the adsorbed oxygen ions, releasing trapped electrons back into the semiconductor conduction band. Consequently, the sensor's electrical resistance $R_s$ drops proportionally to the concentration of the target gas.

#### Electrical Characteristics & Power Budget
- **Operating Voltage:** $5.0\text{ V} \pm 0.1\text{ V}$ DC.
- **Internal Heating Coil:** $R_H \approx 33\ \Omega \pm 5\%$.
- **Heater Current Consumption:** $\approx 150\text{ mA} - 180\text{ mA}$ ($0.75\text{ W} - 0.9\text{ W}$).
- **CRITICAL WARNING:** The heater must run at 5V to maintain its operating temperature of $300^\circ\text{C} - 350^\circ\text{C}$. If powered from 3.3V, the sensor will never achieve thermal equilibrium, causing the readings to drift drastically or flatline.

#### Wiring & ESP32 3.3V Pin Protection
The analog output pin ($AO$) of the MQ-135 module delivers an analog voltage from $0\text{ V}$ up to almost $5\text{ V}$.
> [!CAUTION]
> The ESP32 ADC pins have a strict absolute maximum rating of **3.6 V**. Connecting the MQ-135 $AO$ pin directly to GPIO 35 can damage the ESP32 internal silicon if gas concentration spikes.

**Voltage Divider Solution:**
```
  MQ-135 AO (0 - 5V) ───[ 1 kΩ Resistor ]───┬───► ESP32 GPIO 35 (ADC1_CH7)
                                            │
                                      [ 2 kΩ Resistor ]
                                            │
                                           GND
```
- Maximum voltage at GPIO 35: $V_{GPIO} = 5.0\text{ V} \times \frac{2000}{1000 + 2000} = 3.33\text{ V}$ (completely safe for ESP32).

#### Burn-In, Preheating, & Firmware Logic
1. **Initial Burn-In:** A brand-new MQ-135 requires **24 to 48 hours** of continuous heating in clean ambient air to stabilize the chemical coating.
2. **Boot Warm-Up:** On every system restart, the sensor requires **60 to 180 seconds** to reach temperature. In AquaGuard firmware:
   - `GAS_WARMUP_MS = 60000` (60 seconds countdown).
   - During warm-up, `GasSensor::getLevel()` returns `GasLevel::WARMUP`, and the dashboard displays a countdown timer and amber indicator rather than false positive alarms.
3. **Threshold Values:**
   - **Normal:** Raw ADC $0 - 1500$ (clean air).
   - **Warning:** Raw ADC $1500 - 2800$ (elevated gas / air quality degradation).
   - **Danger:** Raw ADC $> 2800$ (toxic spike / ventilation required).

---

### 2.2. HC-SR04 Ultrasonic Distance Sensor

```
           HC-SR04 Pinout & Orientation
             ┌─────────────────────────┐
             │   ( T )         ( R )   │
             │ Transmitter    Receiver │
             ├─────────────────────────┤
             │  VCC   TRIG  ECHO   GND │
             └───┬──────┬─────┬─────┬──┘
                 │      │     │     │
                 │      │     │     └─► Ground (GND)
                 │      │     └───────► Echo (5V TTL) ──► [1kΩ] ─┬─► GPIO 33
                 │      │                                        │
                 │      │                                      [2kΩ]
                 │      │                                        │
                 │      │                                       GND
                 │      └─────────────► Trigger ◄──────── GPIO 32
                 └────────────────────► +5V DC Rail
```

#### Working Principle & Acoustics
The HC-SR04 measures distance using the **Time-of-Flight (ToF)** of acoustic pulses.
1. The ESP32 asserts a $10\ \mu\text{s}$ digital `HIGH` pulse on `PIN_TRIG` (GPIO 32).
2. The sensor emits an 8-cycle ultrasonic acoustic burst at **40 kHz**.
3. The acoustic wave propagates through air at the speed of sound:
   $$v \approx 331.3 + (0.606 \times T^\circ\text{C})\ \text{m/s} \approx 343\ \text{m/s at } 20^\circ\text{C}$$
   $$v \approx 0.0343\ \text{cm}/\mu\text{s}$$
4. When the sound waves strike an object, they bounce back. The receiver crystal detects the reflection, and the `ECHO` pin transitions `HIGH` for the exact duration of the round trip.
5. Distance calculation:
   $$\text{Distance (cm)} = \frac{\text{Echo Pulse Duration } (\mu\text{s}) \times 0.0343}{2}$$

#### Electrical Interfacing & Echo Level Shifting
- **Supply Voltage:** 5.0 V DC. (Most HC-SR04 models will not function reliably or will have reduced range if powered with 3.3V).
- **Trigger Pin:** 3.3V CMOS output from ESP32 GPIO 32 is recognized as a valid TTL HIGH by the HC-SR04 trigger comparator ($V_{IH} \ge 2.0\text{ V}$).
- **Echo Pin Output:** Outputs a **5.0 V logic pulse**.
- **Level Shifter:** A $1\text{ k}\Omega$ and $2\text{ k}\Omega$ resistor divider converts the 5V pulse to $3.33\text{ V}$, protecting GPIO 33 from overvoltage.

#### Non-Blocking Firmware State Machine & Filtering
Traditional Arduino code uses blocking `pulseIn()`, which freezes the CPU for up to 30–50 ms per reading. In AquaGuard:
- An asynchronous state machine triggers every 100 ms.
- Readings are fed into a **5-sample median filter** (`PROX_SAMPLES = 5`), rejecting acoustic noise, wind draft, or erratic bounce.
- **Hysteresis Logic:**
  - 3 consecutive samples (`PROX_TRIGGER_COUNT = 3`) within a distance zone are required to trigger a warning or danger zone.
  - 5 consecutive samples (`PROX_CLEAR_COUNT = 5`) are required to clear back to normal.
- **Gate Safety Interlock:**
  - `CLEAR` ($> 40\text{ cm}$): Spillway gate operates normally.
  - `WARNING` ($15\text{ cm} - 40\text{ cm}$): Proximity alert, yellow telemetry banner.
  - `DANGER` ($< 15\text{ cm}$): **Proximity Interlock engaged**. The ESP32 locks the gate in place and refuses to open it until the object clears or an operator enters a manual override command from the web UI.

---

### 2.3. SG90 Micro Servo Spillway Gate Actuator

```
           SG90 Micro Servo Connections
                 ┌───────────┐
                 │  [ Horn ] │  <-- Rotates 0° to 100° (Dam Spillway)
                 │  ┌─────┐  │
                 │  │     │  │
                 └──┴─────┴──┘
                    │  │  │
    (Brown) GND  ───┘  │  └─── (Orange) PWM Signal ◄── GPIO 18
    (Red)   +5V  ──────┘
             ▲
             │
     100µF - 470µF Electrolytic Capacitor across 5V & GND
```

#### Working Principle & PWM Timings
The TowerPro SG90 is a 9g analog servo containing a miniature DC motor, reduction gearbox, position feedback potentiometer, and an internal driver IC.
- **PWM Frame Frequency:** 50 Hz (20 ms period).
- **Pulse Width Range:** $500\ \mu\text{s}$ ($0^\circ$) to $2400\ \mu\text{s}$ ($180^\circ$).
- In AquaGuard, the servo arm is mechanically linked to the dam spillway flap:
  - **$0^\circ$**: Spillway gate sealed shut.
  - **$25^\circ$**: Low environmental discharge.
  - **$50^\circ$**: High reservoir release.
  - **$100^\circ$**: Full emergency flood evacuation.

#### The "Brownout Reset" Problem & Electrical Fix
The SG90 idle current is only ~10–20 mA, but when the motor starts moving or encounters resistance, its **stall current spikes to 500 mA – 650 mA**.
> [!WARNING]
> If you power the SG90 directly from the ESP32's onboard 3.3V pin or standard low-current USB 5V regulator, the current spike will drop the 3.3V supply rail below 2.7V. This triggers the ESP32's internal Brownout Detector, causing an immediate crash and restart (`rst:0x10 (RTCWDT_RTC_RESET)`).

**The Solution:**
1. Power the servo from an external **5V DC 2A–3A power supply** (or dedicated 5V rail).
2. Connect the power supply ground to the ESP32 Ground (Common Ground).
3. Place a **$100\ \mu\text{F}$ to $470\ \mu\text{F}$ 16V electrolytic capacitor** directly across the servo's Red (5V) and Brown (GND) wires. The capacitor absorbs instantaneous transient current spikes, keeping the logic voltage rock solid.

#### Slew-Rate Limiting & Idle Auto-Detach
1. **Soft Movement Slew Rate:**
   Directly commanding an RC servo from 0° to 100° causes it to snap at maximum mechanical speed ($>400^\circ/\text{s}$), stressing the plastic gears and causing water splashing.
   The `ServoGate` class implements non-blocking slew rate limiting:
   $$\Delta \theta = \text{SERVO\_SPEED\_DEG\_S} \times \Delta t \quad (60^\circ/\text{s})$$
   A full movement from 0° to 100° takes a smooth, controlled 1.67 seconds.
2. **Idle Auto-Detach:**
   Analog servos often jitter and buzz when holding a position due to minor potentiometer electrical noise.
   After the gate reaches its target and remains static for **2.0 seconds** (`SERVO_IDLE_DETACH_MS = 2000`), the firmware calls `servo.detach()`. The motor stops buzzing, saves power, stays cool, and holds position via gear friction until the next move command arrives.

---

### 2.4. Ultrasonic Reservoir Water Depth & Level Sensing (Replaces 5 Wire Leads)

```
      HC-SR04 Downward-Facing Ultrasonic Reservoir Depth Sensor
      
                     ┌───────────┐
                     │ HC-SR04   │  (Mounted above dam reservoir rim)
                     │ [T]   [R] │  TRIG: GPIO 32  |  ECHO: GPIO 33
                     └─┬───────┬─┘
                       │       │
                       ▼       ▲ Acoustic pulse reflection
            - - - - - - - - - - - - - -  Rim / Full Threshold: <= 5.0 cm (100% DAM WARNING)
           │ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ │
           │    RESERVOIR WATER POOL   │ Linear Depth:
           │ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ │ depth = emptyDist (42cm) - distance (cm)
           │ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ │ depthIn = depthCm / 2.54 (~12" - 18" depth)
            ───────────────────────────  Basin Floor: >= 42.0 cm (0% Empty)
```

- **Ultrasonic Depth Sensing:** The HC-SR04 is mounted over the reservoir looking down at the water surface.
  - **Distance $\le 5.0\text{ cm}$:** Water is right at the spillway rim $\implies$ **100% FULL**, `DAM_WARNING` flood state.
  - **Distance $\ge 42.0\text{ cm}$ (~16.5" total depth):** Basin is dry $\implies$ **0% EMPTY**.
  - **Continuous Linear Percentage:** Calculated on every pulse cycle:
    $$\text{percent} = \text{clamp}\left(100 \times \frac{42.0 - \text{dist}}{42.0 - 5.0},\ 0,\ 100\right)$$
  - **Depth Readouts:** Calculated in both metric (`cm`) and imperial (`inches`) for display on the dashboard:
    $$\text{depthCm} = \text{clamp}(42.0 - \text{dist},\ 0,\ 37.0),\quad \text{depthIn} = \frac{\text{depthCm}}{2.54}$$
- **Virtual Wire Emulation:** The firmware continuously derives SCADA virtual levels from the ultrasonic depth:
  - `low` ($\ge 25\%$), `medium` ($\ge 50\%$), `high` ($\ge 75\%$), `warning` ($\ge 95\%$).
  - **No submerged wire probes needed:** Eliminates corrosion, electrolysis, loose wires, and false short-circuits.
- **Auto Gate-Flow Confirmation:** When the gate opens $>10^\circ$ and water is present, flow is automatically confirmed after 1.2s without requiring a physical wire probe in the tailrace. Safe leak detection remains active.

---

### 2.5. MJE3055T NPN Power Transistor Pump Drivers

```
            MJE3055T Low-Side DC Pump Drive Circuit
            
                         +V External Motor Supply (+5V to +12V)
                                       │
                                       ├───────────────┐
                                       │               │
                                   ┌───┴───┐       ┌───┴───┐
                                   │  (+)  │       │ Cathode
                                   │ PUMP  │       │ Diode (1N4007)
                                   │  (-)  │       │ Anode
                                   └───┬───┘       └───┬───┘
                                       │               │
                                       ├───────────────┘
                                       │
                                  Collector (Pin 2 / Metal Tab)
                                  ┌────┴───┐
      ESP32 GPIO ────[ 330Ω-1kΩ ]─┤ Base   │ MJE3055T
      (16 or 17)      Base Res.   │ (Pin 1)│ NPN TO-220
                                  └────┬───┘
                                  Emitter (Pin 3)
                                       │
                                  Common GND
```

- **MJE3055T Specifications:** TO-220 NPN Epitaxial-Base Silicon Power Transistor ($V_{CEO}=60\text{V}, I_C=10\text{A}, P_D=75\text{W}$).
- **Single-GPIO Low-Side Switching:**
  - **Pump 1 (Inlet):** Driven by **GPIO 16** via hardware LEDC PWM (Channel 0, 1 kHz, 8-bit).
  - **Pump 2 (Outlet):** Driven by **GPIO 17** via hardware LEDC PWM (Channel 1, 1 kHz, 8-bit).
  - Replaces bulky L298N module: frees up 4 GPIO pins and reduces voltage drop ($V_{CE(sat)} \approx 0.3\text{V}-0.5\text{V}$ vs. $\sim 2.0\text{V}$ drop on L298N Darlington drivers).
- **Flyback Diode (Crucial):** A 1N4007 or 1N5819 diode connected in parallel with each pump motor absorbs back-EMF inductive voltage spikes when PWM switches, protecting the transistor.
- **Dry-Run Protection:** If a pump runs continuously for $>60\text{ s}$ while the reservoir is low, a `dryWarning` alert is asserted to protect impellers from dry friction wear.

---

## 3. How the Web Thing Works (End-to-End Architecture)

The web dashboard is an **embedded Single-Page Application (SPA)** that runs entirely in any modern browser without requiring an internet connection or external cloud servers.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ESP32 MICROCONTROLLER                           │
│                                                                        │
│  ┌──────────────┐     ┌──────────────────────────────────────────────┐ │
│  │   LittleFS   │────►│             ESPAsyncWebServer                │ │
│  │  Flash ROM   │     │  Port 80: Static Files (HTML/CSS/JS)         │ │
│  └──────────────┘     │  Port 53: DNS Captive Portal Server          │ │
│                       │  Path /ws: Asynchronous WebSocket Server    │ │
│                       └──────────────────────┬───────────────────────┘ │
│                                              │                         │
│  ┌──────────────┐                            │ JSON Telemetry (500ms)  │
│  │ SafetyManager│◄───────────────────────────┤ User Commands (Realtime)│
│  └──────────────┘                            │                         │
└──────────────────────────────────────────────┼─────────────────────────┘
                                               │ Wi-Fi AP: "AquaGuard-Dam"
                                               │ IP: 192.168.4.1
                                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT WEB BROWSER                              │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ app.js (WebSocket Client, State Machine, Auto-Reconnect)       │   │
│   └──────┬────────────────────┬───────────────────┬────────────────┘   │
│          │                    │                   │                    │
│          ▼                    ▼                   ▼                    │
│   ┌─────────────┐      ┌─────────────┐     ┌─────────────┐             │
│   │ home.js     │      │ control.js  │     │ sensors.js  │             │
│   │ Tank Canvas │      │ Gate Dial   │     │ Gas Gauge   │             │
│   │ Gate SVG    │      │ Pump PWM    │     │ Radar Sweep │             │
│   │ Flow Card   │      │ Mode Select │     │ Wire Matrix │             │
│   └─────────────┘      └─────────────┘     └─────────────┘             │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1. Network Initialization & Captive Portal
1. **Wi-Fi SoftAP Mode:** The ESP32 starts a local Wi-Fi Access Point with SSID `AquaGuard-Dam`, password `dam12345`, on channel 6, with static IP `192.168.4.1`.
2. **mDNS Responder:** Broadcasts service name `dam.local`. Devices on the network can connect directly to `http://dam.local/`.
3. **Captive Portal DNS Server:** An embedded `DNSServer` listens on UDP port 53. Whenever a connected smartphone or laptop tries to check for internet connectivity (e.g. `connectivitycheck.gstatic.com` or `captive.apple.com`), the DNS server returns `192.168.4.1`. The operating system immediately pops up the AquaGuard dashboard modal.

### 3.2. Static File Serving from LittleFS
- When the browser requests `/`, the web server streams `index.html` from the ESP32's onboard LittleFS flash partition.
- `index.html` requests modular assets:
  - `/css/tokens.css`: Design color tokens, radii, fonts, and dark theme variables.
  - `/css/layout.css`: Mobile-first responsive grids and safe-area padding.
  - `/css/components.css`: Glassmorphic cards, neon toggles, and status badges.
  - `/css/animations.css`: Keyframe definitions for ripple rings, pulses, and water waves.
  - `/js/app.js`: WebSocket connection, state router, and dialog handlers.
  - `/js/home.js`: Canvas water tank wave renderer and SVG spillway gate door.
  - `/js/control.js`: Circular arc angle dial and pump controllers.
  - `/js/sensors.js`: MQ-135 analog gauge and HC-SR04 radar sweep canvas.
  - `/js/settings.js`: Live wiring test diagnostics and threshold adjustments.
  - `/js/chart.js`: 5-minute historical water level time-series chart.

### 3.3. Real-Time WebSocket Telemetry Protocol (`/ws`)
Every 500 ms (or immediately upon state changes), the ESP32 pushes a complete JSON packet to all connected clients:
```json
{
  "uptime": 248,
  "freeHeap": 214580,
  "wsClients": 1,
  "mode": "auto",
  "status": "SAFE",
  "alarms": [],
  "interlocked": false,
  "gate": { "target": 0, "actual": 0, "moving": false, "paused": false },
  "level": {
    "percent": 25,
    "wires": { "low": true, "medium": false, "high": false, "warning": false, "flow": false },
    "probeFault": false
  },
  "flow": { "state": "CLOSED", "confirmMs": 0 },
  "proximity": { "distanceCm": 52.4, "zone": "CLEAR" },
  "pumps": [
    { "id": 1, "on": false, "speed": 100, "dryWarning": false, "runtimeS": 0 },
    { "id": 2, "on": false, "speed": 100, "dryWarning": false, "runtimeS": 0 }
  ],
  "fire": false,
  "gas": { "raw": 410, "level": "NORMAL", "warmupS": 0 },
  "history": [25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25]
}
```

### 3.4. Browser Reactive UI Updates
1. **Water Tank Canvas (`home.js`):**
   - Continuously computes a sine-wave surface: $y(x) = \text{baseY} + A \sin(\frac{x}{\lambda} + \phi)$.
   - Water color dynamically shifts from **Cyan** ($0-69\%$) to **Amber** ($70-94\%$) to **Red** ($\ge 95\%$ or Critical Dam Warning).
2. **Spillway Gate SVG (`home.js`):**
   - Directly transforms the `<g id="gate-door-group">` element using SVG matrix rotation: `rotate(angle * -0.55, 55, 35)`.
   - When `flow.state === "FLOW_CONFIRMED"`, animated downward arrows and ripple pulses appear below the dam wall.
3. **Interactive Gate Dial (`control.js`):**
   - Translates touch coordinates $(x, y)$ around the center into an angular sweep between $135^\circ$ and $405^\circ$ ($270^\circ$ sweep).
   - Maps angle directly to 0–100° and transmits `{ cmd: "gate", angle: val }` over the WebSocket.
4. **Proximity Radar Canvas (`sensors.js`):**
   - Animates a rotating sweep beam across a $180^\circ$ arc.
   - Computes radial coordinate for detected obstacles: $r = \frac{\text{dist}}{60\text{ cm}} \times R_{\text{max}}$.
   - Draws a glowing red/amber/cyan blip corresponding to the real-time distance.
5. **MQ-135 Gas Speedometer Canvas (`sensors.js`):**
   - Draws a 3-zone color-coded arc (Normal Green: 0–1500, Warning Amber: 1500–2800, Danger Red: 2800–4095).
   - Animates the needle angle with clean spring easing.

---

### 3.5. Step-by-Step Signal Trace: Flood Emergency Scenario

Here is what happens from physics to browser in under 60 milliseconds:
1. **Physical Event:** Rising flood water touches the DAM WARNING wire inside the miniature reservoir basin.
2. **Microcontroller Hardware:** GPIO 14 is pulled from 3.3V to GND through the water's electrical resistance.
3. **Firmware Debouncing:** `WaterLevel::update()` reads 5 consecutive `LOW` states across 250 ms, confirming a true wet condition.
4. **Safety Manager Evaluation:** `SafetyManager::update()` detects `level.warning == true`.
   - Status switches to `CRITICAL`.
   - Emergency alarm `DAM_WATER_WARNING` is raised.
   - Buzzer begins high-speed pulsing (1000 Hz at 250 ms period).
   - In AUTO mode, `ServoGate::setTarget(100)` is triggered automatically to evacuate the reservoir.
5. **Servo Motor Movement:** The SG90 begins ramping smoothly toward 100° at 60°/sec.
6. **WebSocket Broadcast:** `WebApi::update()` pushes the updated telemetry JSON across the network.
7. **Browser Execution:**
   - `app.js` receives the packet.
   - The top alarm banner flashes crimson: `"ALARM: DAM_WATER_WARNING"`.
   - `home.js` changes the water tank canvas gradient to deep glowing red.
   - The SVG gate door rotates to open position.
   - The tailrace flow wire detects discharging water, and glowing cyan ripple waves radiate across the screen.

---

## 4. Complete Hardware Pinout & Wiring Table

| Component | Signal | ESP32 GPIO | Electrical Logic | Protection / Notes |
|:---|:---|:---|:---|:---|
| **SG90 Servo** | PWM Signal | **GPIO 18** | 3.3V PWM (50 Hz) | 500µs–2400µs; power servo from 5V rail with 100µF capacitor |
| **HC-SR04 Water Sensor** | Trigger | **GPIO 32** | 3.3V Output Pulse | $10\ \mu\text{s}$ pulse width (Mount looking down at reservoir water) |
| **HC-SR04 Water Sensor** | Echo | **GPIO 33** | **5V TTL Input** | **MUST use 1kΩ / 2kΩ voltage divider** to step down to 3.33V |
| **Water Level (Sonar)** | Depth Sensor | **GPIO 32 / 33** | Acoustic ToF | **Replaces 5 wire leads!** $\le 5\text{cm} = 100\%$ Full, $\ge 42\text{cm} = 0\%$ Empty (~12"–18" depth) |
| **MQ-135 Gas** | Analog Out | **GPIO 35** | 0–5V Analog (ADC1_CH7) | **Use 1kΩ / 2kΩ divider** or clamp to keep below 3.3V |
| **Flame Sensor** | Digital Out | **GPIO 23** | Digital Input | Active LOW when IR flame detected |
| **Pump 1 (Inlet)** | MJE3055T Base | **GPIO 16** | 3.3V PWM (1 kHz) | Via 330Ω–1kΩ base resistor; Emitter to GND, Collector to Pump (-) with 1N4007 flyback diode |
| **Pump 2 (Outlet)** | MJE3055T Base | **GPIO 17** | 3.3V PWM (1 kHz) | Via 330Ω–1kΩ base resistor; Emitter to GND, Collector to Pump (-) with 1N4007 flyback diode |
| **Hydro Turbine** | Motor PWM | **GPIO 15** | 3.3V PWM (1 kHz) | Turbine DC motor speed drive via MOSFET / NPN Driver |
| **Hydro Turbine** | Voltage Sense | **GPIO 34** | 0–3.3V Analog (ADC1_CH6) | Voltage divider (10kΩ/3.3kΩ) to measure generated voltage |
| **Piezo Buzzer** | Signal (+) | **GPIO 5** | 3.3V PWM Tone (LEDC) | Tone alarms; auto-silences after 3.8s even if alarm holds |
| **Status LED** | Onboard LED | **GPIO 2** | Active HIGH | Heartbeat pulse / alarm blink |
| *(Conductivity Wires)* | *(Deprecated)* | *GPIO 25,26,27,14,13* | *Not required* | *Internal software emulates virtual levels from HC-SR04 distance* |

---

## 5. Circuit Schematic (ASCII)

```
                       +5V Power Rail (External 5V 2A-3A)
                         │       │       │       │                   │
                         │       │       │       ├──[1N4007 Diode]───┤ (Pump 1 & 2 +V)
                         │       │       │       │   Cathode at +V   │
                         │       │       ├──[100µF Cap]── GND        │
                         │       │       │                           │
                         ▼       ▼       ▼                           ▼
                       MQ-135  HC-SR04  SG90                     Dual DC Pumps
                        VCC     VCC     Red                         (+)   (+)
                         │       │       │                           │     │
                         │       │       │  (Orange: Signal)         │     │
                         │       │       └───────────────────────┐   │     │
                         │       │                               │   ▼     ▼
                         │       │ (Echo 5V)                     │ Pump1 Pump2
                         │       ├───[1kΩ]───┬───► GPIO 33       │  (-)   (-)
                         │       │           │                   │   │     │
                         │       │         [2kΩ]                 │   ▼     ▼
                         │       │           │                   │  Coll. Coll.
                         │       │          GND                  │ ┌───┐ ┌───┐
                         │       │                               │ │   │ │   │ MJE3055T
                         │       └───────────(Trig)◄─── GPIO 32  │ │   │ │   │ (Pin 2)
                         │                                       │ └─┬─┘ └─┬─┘
                         │ (AO 0-5V)                             │   │Base │Base (Pin 1)
                         ├───[1kΩ]───┬───► GPIO 35 (ADC)         │  [R]   [R]  (330Ω - 1kΩ)
                         │           │                           │   ▲     ▲
                         │         [2kΩ]                         │   │     │
                         │           │                           │ GPIO16 GPIO17
                         │          GND                          │
                         │                                       │
                         ▼                                       ▼
                      Common GND ─────────────────────────── GPIO 18
                         │
                         ├───────────────────────────────────────┐
                         ▼                                       ▼
                 ┌───────────────┐                       ┌───────────────┐
                 │ ESP32 DevKit  │                       │ MJE3055T Emit │
                 │ 3.3V Logic    │                       │ Pins 3 to GND │
                 └───────┬───────┘                       └───────────────┘
                         │
                         │ (No messy submerged water wires needed!
                         │  HC-SR04 on GPIO 32/33 measures reservoir
                         │  depth linearly from 5cm to 42cm)
```

---

## 6. Testing, Calibration, & Operation

### 6.1. Running the Web App Locally (Live Mock Server)
To inspect and test the web dashboard in your browser without hardware attached:
1. Open PowerShell or Command Prompt in the project directory:
   ```powershell
   node tools/mock-server/server.js
   ```
2. Open your browser to:
   ```
   http://localhost:3000
   ```
3. Test simulation triggers directly in the browser or via curl:
   - Water rises to 100%: `curl http://localhost:3000/mock/scenario?type=rise`
   - Object approaches gate: `curl http://localhost:3000/mock/scenario?type=prox_near`
   - Clear object: `curl http://localhost:3000/mock/scenario?type=prox_clear`
   - Toxic gas spike: `curl http://localhost:3000/mock/scenario?type=gas_spike`
   - Return to normal: `curl http://localhost:3000/mock/scenario?type=drain`

### 6.2. Flashing the ESP32 Firmware
1. Connect ESP32 via micro-USB.
2. Build and upload firmware using PlatformIO:
   ```powershell
   pio run --target upload
   ```
3. Build and upload LittleFS web filesystem image:
   ```powershell
   pio run --target uploadfs
   ```
4. Connect phone or laptop to Wi-Fi SSID `AquaGuard-Dam` (password: `dam12345`).
5. Open browser to `http://192.168.4.1` or `http://dam.local`.
