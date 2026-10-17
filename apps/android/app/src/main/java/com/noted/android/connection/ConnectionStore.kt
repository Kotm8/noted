package com.noted.android.connection

import android.content.Context

class ConnectionStore(context: Context) {
    private val preferences = context.getSharedPreferences("connection", Context.MODE_PRIVATE)

    var origin: String?
        get() = preferences.getString("origin", null)
        set(value) { preferences.edit().putString("origin", value).apply() }
}
