package ir.frahoosh.novin;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.content.ActivityNotFoundException;
import android.content.Intent;
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
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String HOME_URL = "https://mard7946-dev.github.io/amoozesh-hooshmand-novin-frahoosh/";
    private static final String TRUSTED_HOST = "mard7946-dev.github.io";
    private static final String TRUSTED_PATH = "/amoozesh-hooshmand-novin-frahoosh/";
    private static final int MEDIA_PERMISSION_REQUEST = 4101;
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final String RELEASES_API = "https://api.github.com/repos/mard7946-dev/amoozesh-hooshmand-novin-frahoosh/releases?per_page=20";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean updateDialogShown = false;

    private WebView webView;
    private PermissionRequest pendingMediaRequest;
    private ValueCallback<Uri[]> pendingFileCallback;

    private boolean isTrusted(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        return TRUSTED_HOST.equalsIgnoreCase(host)
                && (uri.getPath() == null || uri.getPath().equals(TRUSTED_PATH.substring(0, TRUSTED_PATH.length() - 1))
                || uri.getPath().startsWith(TRUSTED_PATH));
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
        // Keep content:// access enabled for files explicitly selected by the user.
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
        checkForAppUpdate();
    }


    private void checkForAppUpdate() {
        Thread thread = new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(RELEASES_API).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(7000);
                connection.setReadTimeout(7000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "FrahooshNovin-Android");
                int status = connection.getResponseCode();
                if (status != HttpURLConnection.HTTP_OK) return;
                java.io.InputStream input = connection.getInputStream();
                java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                input.close();

                JSONArray releases = new JSONArray(output.toString("UTF-8"));
                JSONObject newest = null;
                int newestCode = -1;
                for (int i = 0; i < releases.length(); i++) {
                    JSONObject release = releases.getJSONObject(i);
                    if (release.optBoolean("draft", true) || release.optBoolean("prerelease", true)) continue;
                    String tag = release.optString("tag_name", "");
                    if (!tag.matches("novin-v[0-9]+")) continue;
                    int code = Integer.parseInt(tag.substring("novin-v".length()));
                    if (code > newestCode) {
                        newestCode = code;
                        newest = release;
                    }
                }
                if (newest == null || newestCode <= getPackageManager().getPackageInfo(getPackageName(), 0).versionCode) return;

                JSONArray assets = newest.optJSONArray("assets");
                if (assets == null) return;
                String apkUrl = null;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    String name = asset.optString("name", "");
                    if (name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk")) {
                        apkUrl = asset.optString("browser_download_url", null);
                        break;
                    }
                }
                if (apkUrl == null || !apkUrl.startsWith("https://")) return;
                final String downloadUrl = apkUrl;
                final String latestName = newest.optString("name", "نسخه " + newestCode);
                mainHandler.post(() -> showUpdateDialog(latestName, downloadUrl));
            } catch (Exception ignored) {
                // Update checks are best-effort; the app remains usable offline.
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    private void showUpdateDialog(String latestName, String downloadUrl) {
        if (isFinishing() || updateDialogShown) return;
        updateDialogShown = true;
        new AlertDialog.Builder(this)
                .setTitle("بروزرسانی فراهوش نوین")
                .setMessage("نسخه جدیدی منتشر شده است: " + latestName + "\\nبرای دریافت نسخه جدید اقدام کنید. اطلاعات و ورود شما با نصب بروزرسانی حذف نمی‌شود.")
                .setPositiveButton("دریافت بروزرسانی", (dialog, which) -> openExternal(Uri.parse(downloadUrl)))
                .setNegativeButton("بعداً", (dialog, which) -> dialog.dismiss())
                .setCancelable(true)
                .show();
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
