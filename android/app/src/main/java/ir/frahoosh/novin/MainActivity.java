package ir.frahoosh.novin;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private static final String HOME_URL = "https://frahoosh.ir/";
    private static final String TRUSTED_HOST = "frahoosh.ir";
    private static final int MEDIA_PERMISSION_REQUEST = 4101;
    private static final int FILE_CHOOSER_REQUEST = 4102;

    private WebView webView;
    private PermissionRequest pendingMediaRequest;
    private ValueCallback<Uri[]> pendingFileCallback;

    private boolean isTrusted(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        return TRUSTED_HOST.equalsIgnoreCase(host) || ("www." + TRUSTED_HOST).equalsIgnoreCase(host);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(6, 19, 41));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(6, 19, 41));

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrusted(uri)) return false;
                openExternal(uri);
                return true;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleMediaPermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingMediaRequest == request) pendingMediaRequest = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
                pendingFileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "انتخاب فایل"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException exception) {
                    pendingFileCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "انتخاب‌گر فایل در دسترس نیست.", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        webView.loadUrl(HOME_URL);
    }

    private void openExternal(Uri uri) {
        if (uri == null) return;
        String scheme = uri.getScheme();
        if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)
                && !"mailto".equalsIgnoreCase(scheme) && !"tel".equalsIgnoreCase(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "برنامه‌ای برای باز کردن این پیوند پیدا نشد.", Toast.LENGTH_SHORT).show();
        }
    }

    private void handleMediaPermission(PermissionRequest request) {
        if (!isTrusted(request.getOrigin())) {
            request.deny();
            return;
        }

        List<String> allowed = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                allowed.add(resource);
            }
        }
        if (allowed.isEmpty()) {
            request.deny();
            return;
        }

        boolean needsCamera = allowed.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        boolean needsMic = allowed.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        List<String> missing = new ArrayList<>();
        if (needsCamera && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            missing.add(Manifest.permission.CAMERA);
        if (needsMic && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
            missing.add(Manifest.permission.RECORD_AUDIO);

        if (missing.isEmpty()) {
            request.grant(allowed.toArray(new String[0]));
            return;
        }

        if (pendingMediaRequest != null) pendingMediaRequest.deny();
        pendingMediaRequest = request;
        requestPermissions(missing.toArray(new String[0]), MEDIA_PERMISSION_REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MEDIA_PERMISSION_REQUEST || pendingMediaRequest == null) return;

        PermissionRequest request = pendingMediaRequest;
        pendingMediaRequest = null;
        if (!isTrusted(request.getOrigin())) {
            request.deny();
            return;
        }

        List<String> grantedResources = new ArrayList<>();
        boolean allGranted = true;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
                    grantedResources.add(resource);
                else allGranted = false;
            } else if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
                    grantedResources.add(resource);
                else allGranted = false;
            } else {
                allGranted = false;
            }
        }
        if (allGranted && !grantedResources.isEmpty())
            request.grant(grantedResources.toArray(new String[0]));
        else
            request.deny();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && pendingFileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null)
                result = new Uri[]{data.getData()};
            pendingFileCallback.onReceiveValue(result);
            pendingFileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingMediaRequest != null) pendingMediaRequest.deny();
        if (pendingFileCallback != null) pendingFileCallback.onReceiveValue(null);
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}
