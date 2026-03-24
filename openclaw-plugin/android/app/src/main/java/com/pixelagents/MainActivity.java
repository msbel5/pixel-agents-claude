package com.pixelagents;

import android.annotation.SuppressLint;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Pixel Agents Android wrapper — a fullscreen WebView that connects
 * to the OpenClaw Pixel Agents web UI running on a Raspberry Pi.
 *
 * On first launch, shows a settings overlay to enter the Pi's address.
 * Subsequent launches auto-connect to the saved address.
 *
 * The WebView supports:
 * - JavaScript (required for React + Canvas)
 * - WebSocket (required for real-time agent events)
 * - DOM storage (required for settings persistence)
 * - Hardware acceleration (required for smooth canvas rendering)
 */
public class MainActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "pixel_agents_prefs";
    private static final String KEY_URL = "server_url";

    private WebView webView;
    private LinearLayout settingsOverlay;
    private EditText urlInput;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen immersive mode
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );

        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        settingsOverlay = findViewById(R.id.settings_overlay);
        urlInput = findViewById(R.id.url_input);
        Button connectButton = findViewById(R.id.connect_button);

        // Configure WebView
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Hardware acceleration for canvas rendering
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setBackgroundColor(0xFF1E1E2E);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode,
                                       String description, String failingUrl) {
                // Show settings overlay on connection error
                runOnUiThread(() -> showSettings());
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        connectButton.setOnClickListener(v -> {
            String url = urlInput.getText().toString().trim();
            if (!url.isEmpty()) {
                if (!url.startsWith("http://") && !url.startsWith("https://")) {
                    url = "http://" + url;
                }
                saveUrl(url);
                loadUrl(url);
            }
        });

        // Load saved URL or show settings
        String savedUrl = getSavedUrl();
        if (savedUrl != null && !savedUrl.isEmpty()) {
            loadUrl(savedUrl);
        } else {
            showSettings();
        }
    }

    private void loadUrl(String url) {
        settingsOverlay.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        webView.loadUrl(url);
    }

    private void showSettings() {
        settingsOverlay.setVisibility(View.VISIBLE);
        String saved = getSavedUrl();
        if (saved != null) {
            urlInput.setText(saved);
        }
    }

    private void saveUrl(String url) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(KEY_URL, url).apply();
    }

    private String getSavedUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        return prefs.getString(KEY_URL, null);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else if (settingsOverlay.getVisibility() == View.VISIBLE) {
            settingsOverlay.setVisibility(View.GONE);
        } else {
            showSettings();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Re-enter immersive mode
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
