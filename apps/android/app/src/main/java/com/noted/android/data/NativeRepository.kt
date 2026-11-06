package com.noted.android.data

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.noted.android.BuildConfig
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ServerAddress
import com.noted.android.features.tracker.TrackerNotification
import com.noted.android.notifications.PushRegistration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class NativeRepository(private val context: Context) {
    private val secrets = SecretStore(context)
    val local = LocalStore(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutableSession = MutableStateFlow(secrets.read()?.let {
        runCatching { NativeSession.decode(it) }.getOrNull()?.takeIf { session -> session.valid }
    })
    val session = mutableSession.asStateFlow()
    val drafts = NativeDrafts(local, session, scope)
    val changes = MutableStateFlow<Map<String, Long>>(emptyMap())
    val pending = MutableStateFlow<List<PendingMessage>>(emptyList())
    private val flushLock = Mutex()
    @Volatile private var currentApi: NativeApi? = null
    private var imageLoader: coil.ImageLoader? = null
    private var imageAccount: String? = null
    val api: NativeApi get() = currentApi ?: error("Sign in to your server first.")

    init {
        mutableSession.value?.let { configure(it) }
        scope.launch { loadPending(); flush() }
    }

    private fun configure(session: NativeSession) {
        lateinit var configured: NativeApi
        configured = NativeApi(session.origin, session.cookies, onCookies = { cookies ->
            synchronized(local) { if (currentApi === configured) {
                val updated = mutableSession.value?.copy(cookies = cookies)
                if (updated != null) { secrets.write(updated.encode()); mutableSession.value = updated }
            } }
        }, unauthorized = {
            if (currentApi === configured) scope.launch { forget(configured) }
        })
        currentApi = configured
    }

    suspend fun login(address: String, username: String, password: String) = withContext(Dispatchers.IO) {
        val origin = normalize(address)
        var cookies = emptyList<okhttp3.Cookie>()
        val loginApi = NativeApi(origin, onCookies = { cookies = it })
        val user = JSONObject(loginApi.request("/auth/login", "POST", json("username" to username.trim(), "password" to password)))
        val value = NativeSession(origin, user.getString("id"), user.getString("username"), cookies)
        check(value.valid) { "The server did not create a valid sign-in session." }
        mutableSession.value?.let { old -> if (old.partition != value.partition) local.clear(old.partition) }
        secrets.write(value.encode()); configure(value)
        ConnectionStore(context).origin = origin
        mutableSession.value = value
        loadPending(); changed()
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        runCatching { PushRegistration.disconnect(context) }
        runCatching { currentApi?.request("/auth/logout", "POST") }
        forget()
    }

    private suspend fun forget(expected: NativeApi? = null) = withContext(Dispatchers.IO) {
        synchronized(local) {
            if (expected != null && currentApi !== expected) return@withContext
            val previous = mutableSession.value
            currentApi = null; mutableSession.value = null
            previous?.let { local.clear(it.partition); drafts.clear(it.partition) }
        }
        secrets.clear(); pending.value = emptyList()
        TrackerNotification.clear(context)
        PushRegistration.forget(context)
        imageLoader?.shutdown(); imageLoader = null; imageAccount = null
        context.cacheDir.resolve("native-images").deleteRecursively()
        changed()
    }

    fun normalize(address: String): String {
        if (BuildConfig.DEBUG && address.startsWith("http://")) {
            val url = address.trim().toHttpUrl()
            require(url.host in listOf("localhost", "127.0.0.1", "10.0.2.2") && url.encodedPath == "/" &&
                url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null)
            return url.toString().trimEnd('/')
        }
        return ServerAddress.normalize(address)
    }

    suspend fun cached(path: String): String? = withContext(Dispatchers.IO) {
        session.value?.let { local.cached(it.partition, path) }
    }

    suspend fun cachedAt(path: String): Long? = withContext(Dispatchers.IO) {
        session.value?.let { local.savedAt(it.partition, path) }
    }

    suspend fun fetch(path: String): String {
        val account = session.value ?: error("Sign in first.")
        val client = api
        val result = client.request(path)
        withContext(Dispatchers.IO) {
            synchronized(local) { if (currentApi === client) local.save(account.partition, path, result) }
        }
        if (path == "/time-tracking/tracker" || path == "/time-tracking/activities") TrackerNotification.refresh(context, this)
        return result
    }

    suspend fun mutate(path: String, method: String = "POST", body: JSONObject? = null): String {
        val result = api.request(path, method, body)
        changed(topicFor(path))
        return result
    }

    suspend fun saveAppearance(changes: JSONObject) {
        val account = session.value ?: error("Sign in first.")
        val client = api
        val saved = client.request("/settings/appearance", "PUT", changes)
        withContext(Dispatchers.IO) {
            synchronized(local) { if (currentApi === client) local.save(account.partition, "/settings/appearance", saved) }
        }
        changed("settings")
    }

    suspend fun all(path: String): List<JSONObject> {
        val result = mutableListOf<JSONObject>()
        var offset = 0
        while (true) {
            val separator = if ('?' in path) "&" else "?"
            val page = JSONArray(api.request("$path${separator}limit=200&offset=$offset")).objects()
            result.addAll(page)
            if (page.size < 200) break
            offset += page.size
        }
        return result
    }

    suspend fun sendMessage(path: String, content: String, reminder: JSONObject? = null) = withContext(Dispatchers.IO) {
        val account = session.value ?: error("Sign in first.")
        val id = UUID.randomUUID().toString()
        synchronized(local) {
            check(session.value?.partition == account.partition) { "Sign in again before sending." }
            local.enqueue(account.partition, id, path, json("content" to content, "reminder" to reminder, "client_id" to id))
        }
        loadPending()
        WorkManager.getInstance(context).enqueueUniqueWork("native-outbox", ExistingWorkPolicy.APPEND_OR_REPLACE,
            OneTimeWorkRequestBuilder<OutboxWorker>().setConstraints(
                Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        scope.launch { flush() }
    }

    suspend fun retry(id: String) = withContext(Dispatchers.IO) {
        session.value?.let { local.failPending(it.partition, id, null) }
        loadPending(); flush()
    }

    suspend fun discard(id: String) = withContext(Dispatchers.IO) {
        session.value?.let { local.removePending(it.partition, id) }; loadPending()
    }

    suspend fun flush(): Boolean = flushLock.withLock {
        val account = session.value ?: return@withLock true
        val client = currentApi ?: return@withLock true
        for (message in withContext(Dispatchers.IO) { local.pending(account.partition) }) {
            if (message.error != null) continue
            if (currentApi !== client) return@withLock true
            try {
                val saved = JSONObject(client.request(message.path, "POST", message.body))
                withContext(Dispatchers.IO) { synchronized(local) {
                    if (currentApi === client) local.acceptMessage(account.partition, message, saved)
                } }
                changed("notes")
            } catch (error: ApiException) {
                if (error.status >= 500 || error.status == 429) return@withLock false
                if (error.status == 401) return@withLock true
                withContext(Dispatchers.IO) { local.failPending(account.partition, message.id, error.message) }
            } catch (_: java.io.IOException) { return@withLock false }
        }
        loadPending()
        true
    }

    private suspend fun loadPending() = withContext(Dispatchers.IO) {
        synchronized(local) { pending.value = session.value?.let { local.pending(it.partition) }.orEmpty() }
    }

    fun changed(topic: String? = null) {
        val topics = when (topic) {
            null -> setOf("all")
            "tracker" -> setOf("tracker", "schedule", "habits", "nutrition", "home")
            "schedule", "prompts" -> setOf("schedule", "prompts", "home")
            "notes", "reminders", "publishing" -> setOf("notes", "schedule", "home", "publishing")
            "habits" -> setOf("habits", "home")
            "settings" -> setOf("settings", "tracker", "home")
            else -> setOf(topic)
        }
        changes.update { previous -> previous.toMutableMap().apply { topics.forEach { this[it] = (this[it] ?: 0) + 1 } } }
    }

    @Synchronized
    fun images(): coil.ImageLoader {
        val account = session.value!!.partition
        if (imageAccount == account) imageLoader?.let { return it }
        imageLoader?.shutdown()
        val key = java.security.MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString("") { "%02x".format(it) }
        return coil.ImageLoader.Builder(context).okHttpClient(api.client).components {
            if (android.os.Build.VERSION.SDK_INT >= 28) add(coil.decode.ImageDecoderDecoder.Factory()) else add(coil.decode.GifDecoder.Factory())
        }.diskCache { coil.disk.DiskCache.Builder().directory(context.cacheDir.resolve("native-images/$key"))
            .maxSizeBytes(128L * 1024 * 1024).build() }.build().also { imageLoader = it; imageAccount = account }
    }
}

fun topicFor(path: String?): String = when {
    path == null -> "none"
    path.startsWith("/home") -> "home"
    path.startsWith("/habits") -> "habits"
    path.startsWith("/nutrition") -> "nutrition"
    path.startsWith("/templates") -> "templates"
    path.startsWith("/time-tracking") -> "tracker"
    path.startsWith("/schedule/prompts") -> "prompts"
    path.startsWith("/schedule") -> "schedule"
    path.contains("/journal") -> "journals"
    path.endsWith("/document") -> "document"
    path.contains("/messages") || path.startsWith("/search") -> "notes"
    path.contains("scheduled-messages") || path.contains("writing-prompt") -> "publishing"
    path.startsWith("/workspaces") || path.startsWith("/channels") || path.startsWith("/categories") -> "structure"
    path.startsWith("/auth") -> "sessions"
    else -> "settings"
}
