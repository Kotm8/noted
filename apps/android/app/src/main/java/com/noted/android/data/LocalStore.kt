package com.noted.android.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

data class PendingMessage(val id: String, val path: String, val body: JSONObject, val error: String?)

class LocalStore(context: Context) : SQLiteOpenHelper(context, "noted-native.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE cache (account TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, saved INTEGER NOT NULL, PRIMARY KEY(account,path))")
        db.execSQL("CREATE TABLE outbox (account TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL, error TEXT, PRIMARY KEY(account,id))")
        db.execSQL("CREATE TABLE drafts (account TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(account,path))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun cached(account: String, path: String): String? = readableDatabase.rawQuery(
        "SELECT body FROM cache WHERE account=? AND path=?", arrayOf(account, path)).use {
        if (it.moveToFirst()) it.getString(0) else null
    }

    @Synchronized
    fun save(account: String, path: String, body: String) {
        writableDatabase.insertWithOnConflict("cache", null, ContentValues().apply {
            put("account", account); put("path", path); put("body", body); put("saved", System.currentTimeMillis())
        }, SQLiteDatabase.CONFLICT_REPLACE)
        writableDatabase.execSQL("DELETE FROM cache WHERE rowid IN (SELECT rowid FROM cache ORDER BY saved DESC LIMIT -1 OFFSET 500)")
        while (readableDatabase.rawQuery("SELECT COALESCE(SUM(LENGTH(body)),0) FROM cache", null).use { it.moveToFirst(); it.getLong(0) } > 32L * 1024 * 1024) {
            writableDatabase.execSQL("DELETE FROM cache WHERE rowid IN (SELECT rowid FROM cache ORDER BY saved LIMIT 20)")
        }
    }

    @Synchronized
    fun enqueue(account: String, id: String, path: String, body: JSONObject) {
        writableDatabase.insertOrThrow("outbox", null, ContentValues().apply {
            put("account", account); put("id", id); put("path", path)
            put("body", body.toString()); put("created", System.currentTimeMillis())
        })
    }

    @Synchronized
    fun pending(account: String): List<PendingMessage> = readableDatabase.rawQuery(
        "SELECT id,path,body,error FROM outbox WHERE account=? ORDER BY created", arrayOf(account)).use { cursor ->
        buildList { while (cursor.moveToNext()) add(PendingMessage(cursor.getString(0), cursor.getString(1),
            JSONObject(cursor.getString(2)), cursor.getString(3))) }
    }

    @Synchronized
    fun removePending(account: String, id: String) {
        writableDatabase.delete("outbox", "account=? AND id=?", arrayOf(account, id))
    }

    @Synchronized
    fun acceptMessage(account: String, pending: PendingMessage, message: JSONObject) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            cached(account, pending.path)?.let { raw ->
                val page = JSONObject(raw)
                val target = if (pending.path.endsWith("/thread")) page.getJSONObject("replies") else page
                val items = (target.rows("items").filter { it.text("id") != message.text("id") } + message).sortedBy { it.text("created_at") }
                target.put("items", org.json.JSONArray(items))
                save(account, pending.path, page.toString())
            }
            removePending(account, pending.id)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized
    fun failPending(account: String, id: String, error: String?) {
        writableDatabase.update("outbox", ContentValues().apply { put("error", error) },
            "account=? AND id=?", arrayOf(account, id))
    }

    @Synchronized
    fun draft(account: String, path: String): String = readableDatabase.rawQuery(
        "SELECT body FROM drafts WHERE account=? AND path=?", arrayOf(account, path)).use {
        if (it.moveToFirst()) it.getString(0) else ""
    }

    @Synchronized
    fun saveDraft(account: String, path: String, body: String) {
        writableDatabase.insertWithOnConflict("drafts", null, ContentValues().apply {
            put("account", account); put("path", path); put("body", body)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    @Synchronized
    fun clear(account: String) {
        for (table in listOf("cache", "outbox", "drafts")) writableDatabase.delete(table, "account=?", arrayOf(account))
    }
}
