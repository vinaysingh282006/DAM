# AquaGuard Dam SCADA — Native Android Application (.apk)

This Android project bundles the **exact same SCADA UI** directly inside the Android `.apk` package.

---

## ⚡ How It Relieves the ESP32 (Zero Web File Load)

- **Local Storage (`file:///android_asset/index.html`)**: When you launch the APK on your phone, 100% of the HTML, CSS, JavaScript, icons, and sounds load from your **phone's internal flash memory in 0 milliseconds**.
- **No Web Files Transmitted over Wi-Fi**: The ESP32 does **NOT** need to transmit a single byte of web files.
- **Pure Telemetry Wi-Fi Link**: The app connects straight to `ws://192.168.4.1/ws` and `http://192.168.4.1/api/state` using low-bandwidth JSON packets at 10 Hz.

---

## 🛠️ How to Build the .APK in Android Studio

1. Open **Android Studio**.
2. Click **Open** and select the folder:
   ```
   c:\Users\Vinay Singh\Documents\PlatformIO\Projects\DAM\android
   ```
3. Wait for Gradle sync to complete (it has zero external dependencies, so it takes ~15 seconds).
4. In the top menu, click:
   **Build → Build Bundle(s) / APK(s) → Build APK(s)**
5. Android Studio will generate the compiled `.apk` file:
   ```
   android/app/build/outputs/apk/debug/app-debug.apk
   ```
6. Copy `app-debug.apk` to your phone via USB or WhatsApp/Drive and tap to install!

---

## 📱 Alternative: Instant 1-Tap PWA Install (No Android Studio Needed!)

Because the web application includes [sw.js](file:///c:/Users/Vinay%20Singh/Documents/PlatformIO/Projects/DAM/data/sw.js) (Offline Service Worker):
1. Connect your phone to Wi-Fi: **`AquaGuard-Dam`**
2. Open Chrome and navigate to: **`http://192.168.4.1`**
3. Tap Chrome's menu (`⋮` top right) → **"Install app"** (or **"Add to Home screen"**).
4. Android creates an **installed native app icon** on your home screen.
5. All assets are cached on your phone, running in full-screen standalone mode with zero load on the ESP32!
