package uk.co.valeinteractive.prometheus;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {

    private static final String HOME_URL = BuildConfig.PROMETHEUS_HOME_URL;

    private WebView webView;
    private TextView errorView;
    private FrameLayout rootLayout;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        rootLayout = root;

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);

        webView.setWebChromeClient(new WebChromeClient() {

            @Override
            public void onShowCustomView(
                    View view,
                    CustomViewCallback callback
            ) {
                if (fullscreenView != null) {
                    callback.onCustomViewHidden();
                    return;
                }

                fullscreenView = view;
                fullscreenCallback = callback;

                rootLayout.addView(
                        view,
                        new FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.MATCH_PARENT,
                                FrameLayout.LayoutParams.MATCH_PARENT
                        )
                );

                view.requestFocus();
            }

            @Override
            public void onHideCustomView() {
                closeFullscreen();
            }
        });

        webView.setWebViewClient(new WebViewClient() {

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                if (request.isForMainFrame()) {
                    showError();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    WebResourceRequest request
            ) {
                String url = request.getUrl().toString();

                return !url.startsWith(HOME_URL);
            }
        });

        errorView = new TextView(this);
        errorView.setText(
                "PROMETHEUS\n\n"
                        + "Unable to connect to your media server.\n"
                        + "Check your home network connection."
        );
        errorView.setTextColor(Color.WHITE);
        errorView.setTextSize(20);
        errorView.setGravity(android.view.Gravity.CENTER);
        errorView.setVisibility(View.GONE);

        root.addView(
                webView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                )
        );

        root.addView(
                errorView,
                new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                )
        );

        setContentView(root);

        webView.requestFocus();
        webView.loadUrl(HOME_URL);
    }

    private void showError() {
        errorView.setVisibility(View.VISIBLE);
    }

    private boolean sendRemoteKey(String key) {
        return sendRemoteKey(key, true, false);
    }

    private boolean sendRemoteKey(String key, boolean pressed, boolean repeat) {
        if (webView == null) {
            return false;
        }

        String script =
                "(function() {"
                + "var key = " + org.json.JSONObject.quote(key) + ";"
                + "var target = document.activeElement || document.body;"
                + "target.dispatchEvent(new KeyboardEvent('"
                + (pressed ? "keydown" : "keyup") + "', {"
                + "code: key, repeat: " + repeat + ","
                + "key: key,"
                + "bubbles: true,"
                + "cancelable: true"
                + "}));"
                + "})();";

        webView.evaluateJavascript(script, null);
        return true;
    }

    private void handleRemoteBack() {
        String script =
                "(function() {"
                + "var target = document.activeElement || document.body;"
                + "return target.dispatchEvent(new KeyboardEvent('keydown', {"
                + "key: 'BrowserBack', bubbles: true, cancelable: true"
                + "}));"
                + "})();";

        webView.evaluateJavascript(script, unhandled -> {
            if (!"true".equals(unhandled) || isFinishing() || isDestroyed()) {
                return;
            }
            if (webView.canGoBack()) {
                webView.goBack();
            } else {
                finish();
            }
        });
    }

    private void closeFullscreen() {
        if (fullscreenView == null) {
            return;
        }

        View view = fullscreenView;
        WebChromeClient.CustomViewCallback callback =
                fullscreenCallback;

        fullscreenView = null;
        fullscreenCallback = null;

        rootLayout.removeView(view);

        if (callback != null) {
            callback.onCustomViewHidden();
        }

        if (webView != null) {
            webView.requestFocus();
        }
    }

    private boolean isHorizontalKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
                keyCode == KeyEvent.KEYCODE_DPAD_RIGHT;
    }

    private String horizontalKey(int keyCode) {
        return keyCode == KeyEvent.KEYCODE_DPAD_LEFT ? "ArrowLeft" : "ArrowRight";
    }

    private final android.os.Handler horizontalHandler =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private int heldHorizontalKey = KeyEvent.KEYCODE_UNKNOWN;

    private final Runnable repeatHorizontalPress = new Runnable() {
        @Override
        public void run() {
            if (heldHorizontalKey == KeyEvent.KEYCODE_UNKNOWN) return;
            sendRemoteKey(horizontalKey(heldHorizontalKey), true, true);
            horizontalHandler.postDelayed(this, 180);
        }
    };

    private void stopHorizontalRepeat() {
        horizontalHandler.removeCallbacks(repeatHorizontalPress);
        heldHorizontalKey = KeyEvent.KEYCODE_UNKNOWN;
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        if (fullscreenView != null || !isHorizontalKey(keyCode)) {
            return super.dispatchKeyEvent(event);
        }

        if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
            stopHorizontalRepeat();
            heldHorizontalKey = keyCode;
            sendRemoteKey(horizontalKey(keyCode), true, false);
            horizontalHandler.postDelayed(repeatHorizontalPress, 450);
        } else if (event.getAction() == KeyEvent.ACTION_UP && heldHorizontalKey == keyCode) {
            stopHorizontalRepeat();
            if (!event.isCanceled()) {
                sendRemoteKey(horizontalKey(keyCode), false, false);
            }
        }

        return true;
    }

    @Override
    protected void onPause() {
        stopHorizontalRepeat();
        super.onPause();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {

        if (event.getRepeatCount() == 0) {
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    return sendRemoteKey("ArrowUp");

                case KeyEvent.KEYCODE_DPAD_DOWN:
                    return sendRemoteKey("ArrowDown");

                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    return sendRemoteKey("MediaPlayPause");

                case KeyEvent.KEYCODE_MEDIA_PLAY:
                    return sendRemoteKey("MediaPlay");

                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                    return sendRemoteKey("MediaPause");
            }
        }

        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (fullscreenView != null) {
                closeFullscreen();
                return true;
            }
            if (event.getRepeatCount() == 0) {
                handleRemoteBack();
            }
            return true;
        }

        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        closeFullscreen();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }
}
