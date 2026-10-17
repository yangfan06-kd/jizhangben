package com.jizhangben.app;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

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
}
