package com.jizhangben.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.database.sqlite.SQLiteOpenHelper;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.util.Iterator;

/**
 * 只保存应用明确写入/删除过的账本键，不初始化或替换旧 WebView 数据。
 * SQLite 事务提交完成后才返回成功，避免 localStorage 尚未落盘就被进程停止。
 */
public final class LedgerStore {
    private final SQLiteOpenHelper helper;

    public LedgerStore(Context context) {
        helper = new SQLiteOpenHelper(context.getApplicationContext(), "ledger-durable.db", null, 1) {
            @Override
            public void onConfigure(SQLiteDatabase db) {
                db.execSQL("PRAGMA synchronous=FULL");
            }

            @Override
            public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE ledger_values (storage_key TEXT PRIMARY KEY NOT NULL, storage_value TEXT)");
            }

            @Override
            public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
                // 未来结构升级须明确迁移，不删除已有账本值。
            }
        };
    }

    @JavascriptInterface
    public synchronized String readEntries() {
        try (Cursor rows = helper.getReadableDatabase().query(
                "ledger_values", new String[]{"storage_key", "storage_value"},
                null, null, null, null, "storage_key")) {
            JSONObject result = new JSONObject();
            while (rows.moveToNext()) {
                result.put(rows.getString(0), rows.isNull(1) ? JSONObject.NULL : rows.getString(1));
            }
            return result.toString();
        } catch (Exception error) {
            // 不以空目录伪装读取失败，网页据此停止后续写入。
            return "";
        }
    }

    @JavascriptInterface
    public synchronized boolean writeEntries(String serializedChanges) {
        try {
            JSONObject changes = new JSONObject(serializedChanges);
            Iterator<String> validation = changes.keys();
            while (validation.hasNext()) {
                String key = validation.next();
                Object value = changes.get(key);
                if (!key.startsWith("jizhangben_") || key.indexOf('\0') >= 0 ||
                        !(value == JSONObject.NULL || value instanceof String)) return false;
            }
            SQLiteDatabase db = helper.getWritableDatabase();
            db.beginTransaction();
            try {
                Iterator<String> keys = changes.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    ContentValues values = new ContentValues();
                    values.put("storage_key", key);
                    // NULL 是删除标记，防止旧 WebView 副本把已删除的值带回来。
                    if (changes.isNull(key)) values.putNull("storage_value");
                    else values.put("storage_value", changes.getString(key));
                    if (db.insertWithOnConflict("ledger_values", null, values, SQLiteDatabase.CONFLICT_REPLACE) < 0) {
                        throw new SQLiteException("ledger_write_failed");
                    }
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }
}
