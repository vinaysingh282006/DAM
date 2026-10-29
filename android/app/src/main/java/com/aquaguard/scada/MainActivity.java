package com.aquaguard.scada;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.view.Gravity;

/**
 * AquaGuard SCADA — Standalone Android Native WebView Container
 * Connects directly to the ESP32 (192.168.4.1) with full hardware acceleration,
 * persistent offline DOM cache, and native full-screen kiosk display.
 */
public class MainActivity extends Activity {

    // Load UI locally from APK assets: 0ms launch, zero web load on ESP32!
    private static final String SCADA_URL = "file:///android_asset/index.html";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Native full-screen immersive mode
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                             WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );

        FrameLayout rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.parseColor("#0A0E1A"));

        mWebView = new WebView(this);
        mWebView.setBackgroundColor(Color.parseColor("#0A0E1A"));
        WebSettings settings = mWebView.getSettings();

        // High-performance settings for telemetry dashboard
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        mWebView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // If ESP32 is not reached, show a sleek retry status
                if (request.isForMainFrame()) {
                    String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                        + "<style>body{background:#0a0e1a;color:#dfe2f3;font-family:sans-serif;padding:32px;text-align:center;}"
                        + ".card{background:#171b28;border:1px solid #3c494e;border-radius:16px;padding:24px;margin-top:60px;}"
                        + "h2{color:#00d4ff;margin-bottom:8px;}p{font-size:13px;color:#859398;line-height:1.6;}"
                        + "button{background:#00d4ff;color:#003642;border:none;padding:12px 24px;border-radius:8px;font-weight:bold;margin-top:16px;font-size:14px;cursor:pointer;}"
                        + "</style></head><body><div class='card'>"
                        + "<h2>AquaGuard Standalone</h2>"
                        + "<p>Please ensure your phone is connected to the ESP32 Wi-Fi network:<br><b style='color:#4edea3'>AquaGuard-Dam</b></p>"
                        + "<button onclick='location.reload()'>RETRY CONNECTION</button>"
                        + "</div></body></html>";
                    view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                }
            }
        });

        rootLayout.addView(mWebView);
        setContentView(rootLayout);

        // Load ESP32 SCADA Dashboard
        mWebView.loadUrl(SCADA_URL);
    }

    @Override
    public void onBackPressed() {
        if (mWebView != null && mWebView.canGoBack()) {
            mWebView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
