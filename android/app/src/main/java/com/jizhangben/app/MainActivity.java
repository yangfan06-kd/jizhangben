package com.jizhangben.app;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            webView.addJavascriptInterface(new BackupBridge(this), "JizhangbenNative");
            webView.addJavascriptInterface(new LedgerStore(this), "JizhangbenStorage");
            webView.addJavascriptInterface(new UpdateBridge(this), "JizhangbenUpdate");
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleNativeBack();
            }
        });
    }

    private void handleNativeBack() {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            finish();
            return;
        }

        webView.evaluateJavascript(
            "typeof window.handleNativeBack === 'function' ? window.handleNativeBack() : false",
            handled -> {
                if (!"true".equals(handled)) {
                    finish();
                }
            }
        );
    }

    /**
     * 给离线 WebView 提供一个稳定的备份出口。
     * Android 10 及以上通过 MediaStore 写入公共“下载”目录，避免网页 a.download 在 WebView 中没有落盘。
     */
    private static final class BackupBridge {
        private final Context context;

        BackupBridge(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public String saveBackup(String fileName, String content) {
            String safeName = sanitizeFileName(fileName);
            if (safeName.isEmpty() || content == null) return "";
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "";
                    try (OutputStream output = context.getContentResolver().openOutputStream(uri)) {
                        if (output == null) return "";
                        output.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                    ContentValues ready = new ContentValues();
                    ready.put(MediaStore.Downloads.IS_PENDING, 0);
                    context.getContentResolver().update(uri, ready, null, null);
                    return "下载/" + safeName;
                }

                File directory = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!directory.exists() && !directory.mkdirs()) return "";
                File file = new File(directory, safeName);
                try (FileOutputStream output = new FileOutputStream(file)) {
                    output.write(content.getBytes(StandardCharsets.UTF_8));
                }
                return file.getAbsolutePath();
            } catch (Exception ignored) {
                return "";
            }
        }

        private static String sanitizeFileName(String fileName) {
            if (fileName == null) return "";
            String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
            return safe.length() > 120 ? safe.substring(0, 120) : safe;
        }
    }

    /**
     * 更新桥：只读取本机已安装包的版本号，并把唯一官方下载站交给系统浏览器。
     * 不联网、不下载、不安装；任何异常都转成空串或 false，不向网页抛异常。
     */
    private static final class UpdateBridge {
        /** 唯一官方下载站前缀，其它地址一律拒绝。 */
        private static final String DOWNLOAD_SITE_PREFIX = "https://jizhangben-download.pages.dev/";

        private final Context context;

        UpdateBridge(Context context) {
            this.context = context.getApplicationContext();
        }

        @JavascriptInterface
        public String getVersionInfo() {
            try {
                PackageManager manager = context.getPackageManager();
                PackageInfo info = manager.getPackageInfo(context.getPackageName(), 0);
                if (info == null) return "";
                // API 28 起 versionCode 已废弃，优先用 getLongVersionCode()，minSdk 24 回退旧字段。
                long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                        ? info.getLongVersionCode()
                        : info.versionCode;
                JSONObject result = new JSONObject();
                result.put("versionCode", versionCode);
                result.put("versionName", info.versionName == null ? "" : info.versionName);
                return result.toString();
            } catch (Exception ignored) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean openExternalBrowser(String url) {
            if (url == null) return false;
            String target = url.trim();
            if (!target.startsWith(DOWNLOAD_SITE_PREFIX)) return false;
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
                // 从 WebView 的 JS 线程发起，必须带 NEW_TASK 才能启动系统浏览器。
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                return true;
            } catch (Exception ignored) {
                return false;
            }
        }
    }
}
