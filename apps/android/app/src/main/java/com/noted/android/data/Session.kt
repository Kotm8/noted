package com.noted.android.data

import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject

data class NativeSession(val origin: String, val userId: String, val username: String,
    val cookies: List<Cookie>) {
    val partition: String get() = "$origin|$userId"
    val valid: Boolean get() = cookies.any { it.name == "noted_session" && it.expiresAt > System.currentTimeMillis() }

    fun encode(): String = json("origin" to origin, "userId" to userId, "username" to username,
        "cookies" to JSONArray(cookies.map { it.toString() })).toString()

    companion object {
        fun decode(value: String): NativeSession {
            val obj = JSONObject(value)
            val origin = obj.getString("origin")
            val url = origin.toHttpUrl()
            val array = obj.getJSONArray("cookies")
            return NativeSession(origin, obj.getString("userId"), obj.getString("username"),
                (0 until array.length()).mapNotNull { Cookie.parse(url, array.getString(it)) })
        }
    }
}

class SessionCookies(private val origin: HttpUrl, initial: List<Cookie>,
    private val changed: (List<Cookie>) -> Unit) : CookieJar {
    private val cookies = initial.toMutableList()

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (url.scheme != origin.scheme || url.host != origin.host || url.port != origin.port) return
        cookies.forEach { incoming ->
            this.cookies.removeAll { it.name == incoming.name && it.path == incoming.path }
            if (incoming.expiresAt > System.currentTimeMillis()) this.cookies.add(incoming)
        }
        changed(this.cookies.toList())
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> =
        if (url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port)
            cookies.filter { it.matches(url) && it.expiresAt > System.currentTimeMillis() } else emptyList()

    @Synchronized
    fun csrf(): String = cookies.firstOrNull { it.name == "noted_csrf" }?.value.orEmpty()
}
