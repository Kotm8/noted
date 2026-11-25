package com.noted.android.pilot

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.webkit.WebResourceResponse
import androidx.activity.result.ActivityResult
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.IntentCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.noted.android.features.tracker.TrackerTileService
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ServerAddress
import com.noted.android.data.LocalStore
import com.noted.android.data.NativeApi
import com.noted.android.data.NativeRequestSession
import com.noted.android.data.SecretStore
import com.noted.android.data.await
import com.noted.android.notifications.NotificationSyncWorker
import com.noted.android.notifications.PushRegistration
import com.noted.android.notifications.PushState
import com.noted.android.watch.WatchConnection
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.util.UUID
import com.noted.android.BuildConfig
import java.util.concurrent.ConcurrentHashMap

@CapacitorPlugin(
    name = "NotedPilot",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class PilotPlugin : Plugin() {
    private data class Download(val asset: String, val origin: String, val binding: String, val id: String)

    private inner class TransferProgress(private val id: String, private val direction: String) {
        private var last = -100L

        fun update(bytes: Long, total: Long) {
            val now = android.os.SystemClock.elapsedRealtime()
            if (bytes != 0L && bytes != total && now - last < 100L) return
            last = now
            notifyListeners("transferProgress", JSObject().put("id", id).put("direction", direction)
                .put("bytes", bytes).put("total", total))
        }

        fun finish() {
            notifyListeners("transferProgress", JSObject().put("id", id).put("direction", direction).put("done", true))
        }
    }
    private data class Stream(val response: Response, val binding: String?)

    private class PendingRequest {
        private var call: okhttp3.Call? = null
        private var canceled = false

        @Synchronized
        fun attach(value: okhttp3.Call) {
            call = value
            if (canceled) value.cancel()
        }

        @Synchronized
        fun cancel() {
            canceled = true
            call?.cancel()
        }

        @Synchronized
        fun isCanceled() = canceled
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val authOperations = Mutex()
    private val requests = ConcurrentHashMap<String, PendingRequest>()
    private val streams = ConcurrentHashMap<String, Stream>()
    private val live = PilotLive { notifyListeners("liveEvent", it) }
    private val uploads by lazy { PilotMultipart(context) }
    private val offline by lazy { PilotOffline(context) }
    private val pictures by lazy { PilotMediaCache(context) }
    private val incoming by lazy { PilotIncoming(context) }
    private val watches by lazy { PilotWatchPairing(context.applicationContext) }
    private val watchOperations = Mutex()
    private val secrets by lazy { SecretStore(context, "capacitor_pilot") }
    @Volatile private var api: NativeApi? = null
    @Volatile private var download: Download? = null
    @Volatile private var recovery: NativeApi? = null

    override fun load() {
        val saved = secrets.read()
        api = saved?.let { runCatching {
            val record = JSONObject(saved)
            val origin = normalizedOrigin(record.getString("origin"))
            val cookies = record.getJSONArray("cookies")
            connection(origin, (0 until cookies.length()).mapNotNull {
                Cookie.parse(origin.toHttpUrl(), cookies.getString(it))
            })
        }.getOrNull() } ?: if (saved == null) {
            ConnectionStore(context).origin?.let { previous ->
                runCatching { connection(normalizedOrigin(previous), emptyList()) }.getOrNull()
            }
        } else null
        ConnectionStore(context).origin = api?.origin
        openIntent(activity.intent)
    }

    fun openIntent(intent: Intent) {
        if (intent.action in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE) &&
            intent.type?.startsWith("image/") == true
        ) {
            val uris = if (intent.action == Intent.ACTION_SEND_MULTIPLE)
                IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            intent.removeExtra(Intent.EXTRA_STREAM)
            if (uris.isNotEmpty()) stageIncoming(uris.take(4))
            return
        }
        if (intent.action == Intent.ACTION_VIEW && intent.data?.toString() == "noted://log-meal") {
            openRoute("/nutrition?log=1")
            return
        }
        val connection = api ?: return
        val uri = intent.data
        if (intent.action == Intent.ACTION_VIEW && uri?.scheme == "noted") {
            val settings = when {
                uri.host == "connection" && uri.path.isNullOrEmpty() -> "server"
                uri.path == "/connect" && uri.host == "notifications" -> "notifications"
                uri.path == "/connect" && uri.host == "watch" -> "devices"
                else -> null
            }
            if (settings != null) {
                val requestedOrigin = uri.getQueryParameter("origin")
                if (requestedOrigin == null || requestedOrigin == connection.origin) openRoute("/?settings=$settings")
                return
            }
        }
        if (intent.action == Intent.ACTION_VIEW && intent.data?.toString() == "noted://tracker") {
            openRoute("/?track=1")
            return
        }
        if (intent.action == Intent.ACTION_MAIN) {
            val owner = verifiedOwner(connection)
            if (owner != null && incoming.list(connection.origin, owner).length() > 0)
                openSharedMeal()
        }
        openNotification(intent, connection)
    }

    private fun stageIncoming(uris: List<Uri>) {
        val connection = api
        val owner = connection?.let(::verifiedOwner)
        if (connection == null || owner == null) {
            notifyListeners("captureProblem", JSObject().put("message", "Sign in to Noted before sharing a meal photo."), true)
            return
        }
        scope.launch {
            val stored = incoming.stage(connection.origin, owner, uris)
            if (api !== connection || verifiedOwner(connection) != owner) return@launch
            if (stored > 0) openSharedMeal()
            if (stored < uris.size)
                notifyListeners("captureProblem", JSObject().put("message", "Noted couldn't keep every photo. Use up to four JPG, PNG, GIF or WebP images."), true)
        }
    }

    private fun openRoute(path: String) {
        notifyListeners("notificationOpen", JSObject().put("path", path), true)
    }

    private fun openSharedMeal() {
        openRoute("/nutrition?log=1&capture=${UUID.randomUUID()}")
    }

    @PluginMethod
    fun sharedPhotos(call: PluginCall) {
        scope.launch {
            val connection = api
            val owner = connection?.let(::verifiedOwner)
            val photos = if (connection != null && owner != null) incoming.list(connection.origin, owner) else JSONArray()
            if (connection !== api || owner != connection?.let(::verifiedOwner)) {
                call.reject("The sign-in changed.")
                return@launch
            }
            call.resolve(JSObject().put("photos", photos))
        }
    }

    @PluginMethod
    fun discardSharedPhotos(call: PluginCall) {
        val selection = call.getArray("ids")
        val ids = (0 until minOf(4, selection?.length() ?: 0))
            .map { selection!!.optString(it) }.filter(UUID_VALUE::matches).toSet()
        val connection = api
        scope.launch {
            authOperations.withLock {
                val owner = connection?.let(::verifiedOwner)
                if (connection != null && connection === api && owner != null)
                    incoming.discard(connection.origin, owner, ids)
            }
            call.resolve()
        }
    }

    fun incomingPhoto(value: String?): WebResourceResponse? {
        val id = runCatching { UUID.fromString(value) }.getOrNull() ?: return null
        val connection = api ?: return null
        val owner = verifiedOwner(connection) ?: return null
        val response = incoming.open(connection.origin, owner, id) ?: return null
        if (connection === api && verifiedOwner(connection) == owner) return response
        response.data.close()
        return null
    }

    private fun openNotification(intent: Intent, connection: NativeApi) {
        val origin = connection.origin
        val uri = intent.data ?: return
        val fixtureLink = BuildConfig.DEBUG && origin in FIXTURE_ORIGINS && connection.sameOrigin(uri.toString())
        if (!fixtureLink && !ServerAddress.owns(origin, uri.toString())) return
        if (uri.encodedFragment != null) return
        val path = uri.encodedPath ?: return
        if (!NOTIFICATION_PATH.matches(path)) return
        val valid = uri.queryParameterNames.all { key ->
            val value = uri.getQueryParameter(key).orEmpty()
            when (key) {
                "note", "documentReminder", "payment", "habit", "prompt" -> UUID_VALUE.matches(value)
                "day" -> DATE_VALUE.matches(value)
                "write" -> value == "1"
                "track" -> value == "1" && path in setOf("/", "/home")
                else -> false
            }
        }
        if (valid) {
            val destination = path + (uri.encodedQuery?.let { "?$it" } ?: "")
            openRoute(destination)
        }
    }

    @PluginMethod
    fun notificationState(call: PluginCall) {
        val state = PushState(context).read()
        val allowed = notificationPermission()
        call.resolve(JSObject()
            .put("deviceId", PushRegistration.deviceId(context))
            .put("paired", state?.optString("secret")?.isNotBlank() == true)
            .put("permission", if (allowed) "granted" else if (
                Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT
            ) "default" else "denied"))
    }

    @PluginMethod
    fun enableNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult")
        } else notificationPermissionResult(call)
    }

    @PermissionCallback
    private fun notificationPermissionResult(call: PluginCall) {
        val connection = api
        if (connection == null || !connection.origin.startsWith("https://")) {
            call.reject("Connect to your HTTPS Noted server to enable notifications.")
            return
        }
        if (!notificationPermission()) {
            call.reject("Allow Noted notifications and the Reminders channel in Android settings.")
            return
        }
        scope.launch {
            try {
                authOperations.withLock {
                    check(api === connection && PilotTracker.binding(connection) != null)
                    PushRegistration.enable(context, connection)
                }
                call.resolve()
            } catch (error: Exception) {
                call.reject(error.message ?: "Could not connect notifications.")
            }
        }
    }

    @PluginMethod
    fun disableNotifications(call: PluginCall) {
        scope.launch {
            authOperations.withLock { PushRegistration.disable(context) }
            call.resolve()
        }
    }

    @PluginMethod
    fun reconcileNotifications(call: PluginCall) {
        NotificationSyncWorker.enqueue(context)
        call.resolve()
    }

    private fun notificationPermission(): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            context.getSystemService(NotificationManager::class.java)
                .getNotificationChannel("noted_reminders")?.importance != NotificationManager.IMPORTANCE_NONE

    @PluginMethod
    fun profile(call: PluginCall) {
        call.resolve(JSObject().put("server", api?.origin ?: JSONObject.NULL).put("packageName", context.packageName))
    }

    @PluginMethod
    fun legacyWorkAvailable(call: PluginCall) {
        val connection = api
        scope.launch {
            val owner = connection?.let(::verifiedOwner)
            val available = if (connection != null && owner != null && context.getDatabasePath("noted-native.db").isFile) {
                runCatching {
                    LocalStore(context).use { it.hasUnsent("${connection.origin}|$owner") }
                }.getOrDefault(false)
            } else false
            call.resolve(JSObject().put("available", available && api === connection && owner == connection?.let(::verifiedOwner)))
        }
    }

    @PluginMethod
    fun exportLegacyWork(call: PluginCall) {
        val connection = api
        if (connection == null || verifiedOwner(connection) == null) {
            call.reject("Sign in to the original server to recover unsent work.")
            return
        }
        synchronized(this) {
            if (recovery != null) {
                call.reject("A recovery export is already open.")
                return
            }
            recovery = connection
        }
        try {
            startActivityForResult(call,
                Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json").putExtra(Intent.EXTRA_TITLE, "Noted unsent work.json"),
                "legacyWorkDestination")
        } catch (_: Exception) {
            recovery = null
            call.reject("Couldn't open Android's file picker.")
        }
    }

    @ActivityCallback
    private fun legacyWorkDestination(call: PluginCall?, result: ActivityResult) {
        val connection = recovery
        val destination = result.data?.data
        if (call == null || result.resultCode != Activity.RESULT_OK || destination == null) {
            recovery = null
            call?.resolve(JSObject().put("saved", false))
            return
        }
        scope.launch {
            try {
                authOperations.withLock {
                    val owner = connection?.let(::verifiedOwner)
                    check(connection != null && connection === api && owner != null && destination.scheme == "content") {
                        "The sign-in changed. Open recovery again."
                    }
                    check(context.getDatabasePath("noted-native.db").isFile) { "No old unsent work was found." }
                    LocalStore(context).use { records ->
                        val key = "${connection.origin}|$owner"
                        check(records.hasUnsent(key)) { "No unsent work was found for this account." }
                        val output = context.contentResolver.openOutputStream(destination, "wt")
                            ?: error("Couldn't open this file.")
                        output.bufferedWriter().use { records.exportUnsent(key, it) }
                    }
                }
                call.resolve(JSObject().put("saved", true))
            } catch (error: Exception) {
                call.reject(error.message ?: "Couldn't save the recovery file.")
            } finally {
                recovery = null
            }
        }
    }

    @PluginMethod
    fun listWatches(call: PluginCall) {
        scope.launch {
            try {
                val connection = api ?: error("Sign in before pairing your watch.")
                check(verifiedBinding(connection) != null) { "Sign in before pairing your watch." }
                val nodes = try {
                    watches.devices()
                } catch (_: Exception) {
                    error("Watch discovery is unavailable. Check that Google Play services and your watch are connected.")
                }
                check(api === connection && verifiedBinding(connection) != null)
                call.resolve(JSObject().put("devices", JSONArray(nodes.map { node ->
                    JSONObject().put("id", node.id).put("name", node.displayName)
                })))
            } catch (error: Exception) {
                call.reject(error.message ?: "Couldn't find a connected watch.")
            }
        }
    }

    @PluginMethod
    fun pairWatch(call: PluginCall) {
        val id = call.getString("id").orEmpty()
        val connection = api
        if (connection == null || id.length !in 1..256 || !connection.origin.startsWith("https://")) {
            call.reject("Connect to your HTTPS Noted server before pairing a watch.")
            return
        }
        scope.launch {
            if (!watchOperations.tryLock()) {
                call.reject("Watch pairing is already in progress.")
                return@launch
            }
            try {
                check(watches.devices().any { it.id == id }) { "The watch is no longer connected." }
                val (binding, ticket) = authOperations.withLock {
                    val active = verifiedBinding(connection)
                    check(api === connection && active != null) { "Sign in again before pairing." }
                    active to JSONObject(connection.request("/wear/pairings", "POST")).getString("ticket")
                }
                watches.pair(id, connection.origin, ticket)
                authOperations.withLock {
                    check(api === connection && verifiedBinding(connection) == binding) { "The sign-in changed." }
                    WatchConnection.save(context, connection.origin, id)
                }
                call.resolve()
            } catch (error: Exception) {
                call.reject(error.message ?: "Couldn't pair the watch.")
            } finally {
                watchOperations.unlock()
            }
        }
    }

    private fun verifiedOwner(connection: NativeApi): UUID? =
        PilotTracker.binding(connection)?.let { offline.owner(connection.origin, it) }

    private fun verifiedBinding(connection: NativeApi): String? =
        PilotTracker.binding(connection)?.takeIf { offline.owner(connection.origin, it) != null }

    @PluginMethod
    fun openLive(call: PluginCall) {
        val connection = api
        val id = call.getString("id").orEmpty()
        if (connection == null || !UUID_VALUE.matches(id)) {
            call.reject("Choose a Noted server to receive updates.")
            return
        }
        live.start(id, connection)
        call.resolve()
    }

    @PluginMethod
    fun closeLive(call: PluginCall) {
        call.getString("id")?.let(live::stop)
        call.resolve()
    }

    @PluginMethod
    fun beginUpload(call: PluginCall) {
        val id = call.getString("id").orEmpty()
        val path = call.getString("path").orEmpty()
        val type = call.getString("type").orEmpty()
        val binding = api?.let(PilotTracker::binding)
        if (!UUID_VALUE.matches(id) || binding == null || PilotMultipart.limit(path) == null) {
            call.reject("Sign in before uploading files to this location.")
            return
        }
        scope.launch {
            try {
                if (api?.let(PilotTracker::binding) != binding)
                    throw IOException("The sign-in changed.")
                uploads.begin(id, path, binding, type)
                call.resolve()
            } catch (failure: Exception) {
                call.reject(failure.message ?: "Could not prepare this upload.")
            }
        }
    }

    @PluginMethod
    fun appendUpload(call: PluginCall) {
        val id = call.getString("id").orEmpty()
        val offset = (call.getInt("offset") ?: -1).toLong()
        val chunk = call.getString("chunk").orEmpty()
        val binding = api?.let(PilotTracker::binding)
        scope.launch {
            try {
                uploads.append(id, binding, offset, chunk)
                call.resolve()
            } catch (_: Exception) {
                call.reject("Could not prepare these files. Check their size and available storage.")
            }
        }
    }

    @PluginMethod
    fun downloadAttachment(call: PluginCall) {
        val asset = call.getString("asset").orEmpty()
        val connection = api
        val binding = connection?.let(PilotTracker::binding)
        if (!UUID_VALUE.matches(asset) || connection == null || binding == null) {
            call.reject("Sign in before saving this attachment.")
            return
        }
        synchronized(this) {
            if (download != null) {
                call.reject("A download is already in progress.")
                return
            }
            download = Download(asset, connection.origin, binding, UUID.randomUUID().toString())
        }
        val name = call.getString("name").orEmpty().substringAfterLast('/').substringAfterLast('\\')
            .filterNot(Char::isISOControl).take(180).ifBlank { "Noted attachment" }
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, name)
        try {
            startActivityForResult(call, intent, "attachmentDestination")
        } catch (_: Exception) {
            download = null
            call.reject("Couldn't open Android's file picker.")
        }
    }

    @ActivityCallback
    private fun attachmentDestination(call: PluginCall?, result: ActivityResult) {
        val destination = result.data?.data
        val selected = download
        val connection = api
        if (result.resultCode != Activity.RESULT_OK || destination == null || call == null || selected == null) {
            download = null
            call?.resolve()
            return
        }
        val progress = TransferProgress(selected.id, "download")
        scope.launch {
            try {
                check(destination.scheme == "content" && connection != null && selected.origin == connection.origin &&
                    api === connection && PilotTracker.binding(connection) == selected.binding)
                val session = requestSession(connection)
                check(PilotTracker.binding(session.cookies) == selected.binding)
                val request = Request.Builder().url(connection.url("/api/v1/attachments/${selected.asset}/download"))
                    .tag(NativeRequestSession::class.java, session).build()
                connection.transferClient.newCall(request).await().use { response ->
                    val body = response.body
                    check(response.code == 200 && body?.contentType()?.toString() == "application/octet-stream" &&
                        body.contentLength() in 0..MAX_ATTACHMENT && api === connection &&
                        PilotTracker.binding(connection) == selected.binding)
                    val total = body.contentLength()
                    progress.update(0, total)
                    val output = context.contentResolver.openOutputStream(destination, "wt") ?: error("File is unavailable.")
                    output.use { target ->
                        body.byteStream().use { source ->
                            val buffer = ByteArray(65536)
                            var written = 0L
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                val count = source.read(buffer)
                                if (count < 0) break
                                written += count
                                check(written <= MAX_ATTACHMENT && api === connection &&
                                    PilotTracker.binding(connection) == selected.binding)
                                target.write(buffer, 0, count)
                                progress.update(written, total)
                            }
                            check(written == total)
                        }
                    }
                }
                call.resolve()
            } catch (_: Exception) {
                call.reject("Couldn't finish saving the attachment.")
            } finally {
                progress.finish()
                download = null
            }
        }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val origin = runCatching { normalizedOrigin(call.getString("server").orEmpty()) }.getOrElse {
            call.reject("Enter your Noted server's HTTPS address.")
            return
        }
        val previous = api
        if (origin == previous?.origin) {
            call.resolve(JSObject().put("server", origin))
            return
        }
        scope.launch {
            try {
                val candidate = NativeApi(origin)
                val request = Request.Builder().url(candidate.url("/api/v1/health/ready")).build()
                candidate.client.newCall(request).await().use { response ->
                    val body = response.body
                    if (!response.isSuccessful || body?.contentType()?.subtype != "json")
                        throw IOException("Server is not ready")
                    val source = body.source()
                    if (source.request(4097) || JSONObject(source.readUtf8()).optString("status") != "ready")
                        throw IOException("Server is not ready")
                }
                authOperations.withLock {
                    check(api === previous)
                    save(origin, emptyList())
                    api = connection(origin, emptyList())
                    ConnectionStore(context).origin = origin
                    if (previous != null) {
                        live.stop()
                        requests.values.forEach { it.cancel() }
                        streams.keys.forEach { closeStream(it) }
                        uploads.clear()
                        runCatching { offline.lock(discard = false) }
                        runCatching { pictures.clear() }
                        runCatching { PushRegistration.disable(context) }
                        com.noted.android.features.tracker.TrackerNotification.clear(context)
                        TrackerTileService.refresh(context)
                    }
                }
                call.resolve(JSObject().put("server", origin))
            } catch (_: Exception) {
                call.reject("Couldn't connect to a ready Noted server. Check the address and try again.")
            }
        }
    }

    @PluginMethod
    fun request(call: PluginCall) {
        val connection = api
        val id = call.getString("id").orEmpty()
        val path = call.getString("path").orEmpty()
        val method = call.getString("method").orEmpty()
        val body = call.getString("body")
        val multipart = call.getBoolean("multipart", false) == true
        if (connection == null || id.length != 36 || !allowedPath(path, method) ||
            (body?.length ?: 0) > MAX_JSON || (method == "GET" && body != null) ||
            (multipart && (!PilotMultipart.allowed(path, method) || body != null))
        ) {
            call.reject("This operation isn't available in the Android app.")
            return
        }
        val streaming = method == "POST" && path in STREAMING
        val changesPassword = path == PASSWORD_PATH && method == "PUT"
        val updatesSession = path == "/auth/login" || changesPassword
        val isAuth = path.startsWith("/auth/") || changesPassword
        val client = if (streaming || multipart) connection.transferClient else connection.client
        val session = requestSession(connection)
        val requestedBinding = PilotTracker.binding(session.cookies)
        val pending = PendingRequest()
        if (requests.putIfAbsent(id, pending) != null) {
            call.reject("This request is already in progress.")
            return
        }
        val progress = if (multipart) TransferProgress(id, "upload") else null
        scope.launch {
            var opened: Response? = null
            var handedOff = false
            var authLocked = false
            try {
                if (isAuth) {
                    authOperations.lock()
                    authLocked = true
                }
                if (api !== connection || pending.isCanceled()) throw IOException("The sign-in changed.")
                val payload = when {
                    progress != null -> uploads.claim(id, path, requestedBinding, progress::update)
                    body != null -> body.toRequestBody(JSON)
                    method in setOf("POST", "PUT", "PATCH") -> ByteArray(0).toRequestBody()
                    else -> null
                }
                val request = Request.Builder().url(connection.url("/api/v1$path"))
                    .header("Accept", if (streaming) "application/x-ndjson, application/json" else "application/json")
                    .apply {
                        if (path !in setOf("/auth/login", "/auth/status", "/auth/session"))
                            tag(NativeRequestSession::class.java, session)
                    }
                    .method(method, payload).build()
                val sending = client.newCall(request)
                pending.attach(sending)
                val response = sending.await()
                opened = response
                val activeBinding = PilotTracker.binding(connection)
                if (api !== connection || (!isAuth && requestedBinding != activeBinding))
                    throw IOException("The sign-in changed.")
                if (method == "GET" && response.code in setOf(502, 503, 504)) {
                    val cached = offline.response(connection.origin, activeBinding, path)
                    if (cached != null && !pending.isCanceled()) {
                        call.resolve(cached)
                        return@launch
                    }
                }
                val content = response.body
                val type = content?.contentType()?.subtype
                if (streaming && response.isSuccessful && type == "x-ndjson") {
                    streams[id] = Stream(response, requestedBinding)
                    if (sending.isCanceled()) {
                        streams.remove(id)
                        throw IOException("Request canceled")
                    }
                    opened = null
                    handedOff = true
                    call.resolve(JSObject().put("status", response.code).put("streaming", true))
                    return@launch
                }
                if (response.isRedirect || (content != null && response.code != 204 && type != "json")) {
                    call.reject("The selected server returned an unexpected response.")
                    return@launch
                }
                val source = content?.source()
                if (source?.request(MAX_JSON.toLong() + 1) == true)
                    throw IOException("Server response is too large")
                val responseBody = source?.readUtf8().orEmpty()
                if (api !== connection || (!isAuth && requestedBinding != PilotTracker.binding(connection)))
                    throw IOException("The sign-in changed.")
                if (updatesSession && response.isSuccessful) {
                    uploads.clear()
                    if (changesPassword) live.reconnect()
                }
                if (response.isSuccessful && activeBinding != null &&
                    (updatesSession || path == "/auth/session")
                ) {
                    runCatching { offline.verify(connection.origin, activeBinding, responseBody) }
                }
                if (path == "/auth/session" && response.code == 401 &&
                    runCatching { JSONObject(responseBody).optString("detail") == "Sign in to continue" }.getOrDefault(false)
                ) {
                    live.stop()
                    uploads.clear()
                    runCatching { offline.lock(discard = false) }
                    runCatching { connection.jar.clear() }
                }
                if (path == "/auth/logout" && response.isSuccessful) {
                    live.stop()
                    uploads.clear()
                    runCatching { offline.lock(discard = true) }
                    runCatching { pictures.clear() }
                    PushRegistration.disconnect(context)
                    com.noted.android.features.tracker.TrackerNotification.clear(context)
                    TrackerTileService.refresh(context)
                }
                if (path == "/time-tracking/tracker" && response.isSuccessful) {
                    val binding = PilotTracker.binding(connection)
                    if (binding != null) scope.launch {
                        runCatching { PilotTracker.sync(context, expected = binding, snapshot = JSONObject(responseBody)) }
                    }
                }
                if (path == "/auth/login" && response.isSuccessful && PushRegistration.wasEnabled(context) &&
                    connection.origin.startsWith("https://") && notificationPermission()
                ) {
                    scope.launch {
                        authOperations.withLock {
                            if (api === connection && PilotTracker.binding(connection) == activeBinding)
                                runCatching { PushRegistration.enable(context, connection) }
                        }
                    }
                }
                if (method == "GET" && response.code == 200 && PilotOffline.cacheable(path)) {
                    runCatching { offline.save(connection.origin, activeBinding, path, responseBody) }
                }
                call.resolve(JSObject().put("status", response.code).put("body", responseBody)
                    .apply { if (response.isSuccessful && (updatesSession || path == "/auth/session")) put("offline", false) })
            } catch (failure: Exception) {
                val binding = PilotTracker.binding(connection)
                val cached = if (failure is IOException && method == "GET" && api === connection && binding == requestedBinding &&
                    !pending.isCanceled()) runCatching { offline.response(connection.origin, binding, path) }.getOrNull()
                    else null
                if (cached != null) call.resolve(cached)
                else call.reject("Couldn't reach your server. Check your connection and try again.")
            } finally {
                if (authLocked) authOperations.unlock()
                progress?.finish()
                if (multipart) uploads.clear(id)
                opened?.close()
                if (!handedOff) requests.remove(id, pending)
            }
        }
    }

    @PluginMethod
    fun read(call: PluginCall) {
        val id = call.getString("id").orEmpty()
        val stream = streams[id]
        val source = stream?.response?.body?.source()
        if (stream == null || source == null) {
            call.reject("The server stream is closed.")
            return
        }
        scope.launch {
            try {
                check(api?.let(PilotTracker::binding) == stream.binding)
                val buffer = Buffer()
                val done = source.read(buffer, 64L * 1024) == -1L
                check(api?.let(PilotTracker::binding) == stream.binding)
                if (done) closeStream(id)
                call.resolve(JSObject().put("chunk", buffer.readByteString().base64()).put("done", done))
            } catch (_: Exception) {
                closeStream(id)
                call.reject("The connection dropped. Try again.")
            }
        }
    }

    @PluginMethod
    fun cancelRequest(call: PluginCall) {
        val id = call.getString("id") ?: return call.resolve()
        requests[id]?.cancel()
        scope.launch {
            closeStream(id)
            uploads.clear(id)
            call.resolve()
        }
    }

    private fun closeStream(id: String) {
        val stream = streams.remove(id) ?: return
        requests.remove(id)
        stream.response.close()
    }

    fun media(path: String, query: String?, range: String?): WebResourceResponse? {
        val icon = ICON_PATH.matches(path)
        if (!icon && !MEDIA_PATH.matches(path)) return null
        if (query != null && !(if (icon) ICON_QUERY else MEDIA_QUERY).matches(query)) return null
        val connection = api ?: return null
        val session = requestSession(connection)
        val binding = PilotTracker.binding(session.cookies) ?: return null
        val playback = path.endsWith("/playback")
        val urlPath = if (icon && query != null) "$path?$query" else path
        val key = if (playback || (icon && query == null)) null else offline.mediaKey(connection.origin, binding, urlPath)
        fun authorized() = api === connection && PilotTracker.binding(connection) == binding
        fun cached() = key?.takeIf { authorized() &&
            offline.mediaKey(connection.origin, binding, urlPath) == it }?.let(pictures::open)
        val request = Request.Builder().url(connection.url(urlPath)).tag(NativeRequestSession::class.java, session).apply {
            if (playback && range != null && RANGE.matches(range)) header("Range", range)
        }.build()
        val response = runCatching { connection.transferClient.newCall(request).execute() }.getOrNull() ?: return cached()
        if (response.code in setOf(502, 503, 504)) {
            response.close()
            return cached()
        }
        val body = response.body
        val mime = body?.contentType()?.toString()
        if (body == null || response.code !in listOf(200, 206) ||
            mime == null || mime !in (if (playback) VIDEO_MIMES else PilotMediaCache.IMAGE_TYPES) ||
            !authorized()
        ) {
            response.close()
            return null
        }
        val headers = mutableMapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
        for (name in listOf("Content-Length", "Content-Range", "Accept-Ranges"))
            response.header(name)?.let { headers[name] = it }
        val content = pictures.record(key, mime, response) {
            authorized() && offline.mediaKey(connection.origin, binding, urlPath) == key
        }
        return WebResourceResponse(mime, null, response.code,
            if (response.code == 206) "Partial Content" else "OK", headers, content)
    }

    @PluginMethod
    fun hideKeyboard(call: PluginCall) {
        activity.runOnUiThread {
            WindowCompat.getInsetsController(activity.window, bridge.webView)
                .hide(WindowInsetsCompat.Type.ime())
            call.resolve()
        }
    }

    @PluginMethod
    fun openAiSignIn(call: PluginCall) {
        val destination = runCatching { URI(call.getString("url").orEmpty()) }.getOrNull()
        if (destination?.scheme != "https" || destination.host != "auth.openai.com" ||
            destination.port !in setOf(-1, 443) || destination.rawUserInfo != null ||
            destination.rawPath != "/oauth/authorize" || destination.rawFragment != null
        ) {
            call.reject("The server returned an invalid sign-in address.")
            return
        }
        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(destination.toString())).addCategory(Intent.CATEGORY_BROWSABLE))
                call.resolve()
            } catch (_: android.content.ActivityNotFoundException) {
                call.reject("No browser is available to open ChatGPT sign-in.")
            }
        }
    }

    @PluginMethod
    fun shareText(call: PluginCall) {
        val content = call.getString("text").orEmpty()
        if (content.isBlank() || content.length > 100_000) {
            call.reject("Choose a text note to share.")
            return
        }
        activity.runOnUiThread {
            val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, content)
            activity.startActivity(Intent.createChooser(intent, "Share note"))
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        live.stop()
        requests.values.forEach { it.cancel() }
        scope.launch {
            streams.keys.forEach { closeStream(it) }
            uploads.clear()
        }.invokeOnCompletion {
            scope.cancel()
        }
    }

    private fun connection(origin: String, cookies: List<Cookie>): NativeApi {
        lateinit var owner: NativeApi
        owner = NativeApi(origin, cookies, { changed -> if (api === owner) save(origin, changed) },
            acceptsCookieResponse = { path ->
                path in COOKIE_RESPONSE_PATHS || path.startsWith("/api/v1/auth/sessions/")
            })
        return owner
    }

    private fun requestSession(connection: NativeApi) = NativeRequestSession(
        connection.jar.loadForRequest(connection.url("/api/v1/auth/session").toHttpUrl())
            .filter { it.name in SESSION_COOKIES },
    )

    private fun save(origin: String, cookies: List<Cookie>) {
        secrets.write(JSONObject().put("origin", origin)
            .put("cookies", JSONArray(cookies.filter { it.name in SESSION_COOKIES }.map(Cookie::toString)))
            .toString())
    }

    private fun normalizedOrigin(value: String) =
        if (BuildConfig.DEBUG && value in FIXTURE_ORIGINS) value else ServerAddress.normalize(value)

    companion object {
        private val FIXTURE_ORIGINS = setOf("http://localhost:8123", "http://localhost:8125")
        private const val MAX_JSON = 8 * 1024 * 1024
        private const val MAX_ATTACHMENT = 250L * 1024 * 1024
        private val MEDIA_PATH = Regex("/api/v1/(?:(nutrition|finance)/photos/[A-Za-z0-9_-]+|attachments/[A-Za-z0-9_-]+/(preview|original|playback))")
        private val MEDIA_QUERY = Regex("(?:v=2(?:&retry=[0-9]{1,6})?|retry=[0-9]{1,6})")
        private val ICON_PATH = Regex("/api/v1/workspaces/[A-Za-z0-9_-]+/icon")
        private val ICON_QUERY = Regex("v=[0-9a-f]{32}")
        private val VIDEO_MIMES = setOf("video/mp4", "video/webm", "video/quicktime")
        private val RANGE = Regex("bytes=([0-9]{1,12}-[0-9]{0,12}|-[0-9]{1,12})")
        private val NOTIFICATION_PATH = Regex("/|/(home|schedule|habits|finance)|/w/[A-Za-z0-9_-]+/c/[A-Za-z0-9_-]+")
        private val UUID_VALUE = Regex("[0-9a-fA-F-]{36}")
        private val DATE_VALUE = Regex("\\d{4}-\\d{2}-\\d{2}")
        private val JSON = "application/json".toMediaType()
        private val SESSION_COOKIES = setOf("noted_session", "noted_csrf")
        private const val PASSWORD_PATH = "/settings/password"
        private val COOKIE_RESPONSE_PATHS = setOf("/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/renew", "/api/v1$PASSWORD_PATH")
        private val METHODS = setOf("GET", "POST", "PUT", "PATCH", "DELETE")
        private val PATH = Regex("(?:/[A-Za-z0-9_-]+)+")
        private val AUTH = setOf("/auth/login", "/auth/status", "/auth/session", "/auth/sessions", "/auth/logout", "/auth/renew")
        private val STREAMING = setOf("/ai/nutrition/estimate", "/ai/nutrition/target", "/ai/assistant", "/ai/runs", "/ai/calendar/runs")
        private val AI_READ = setOf("/ai/status", "/ai/preferences", "/ai/models", "/ai/prompts")
        private val AI_PROMPT = Regex("/ai/prompts/[A-Za-z0-9_-]+")
        private val AI_RUN = Regex("/ai/runs/[A-Za-z0-9_-]+")
        private val AI_CONVERSATION = Regex("/ai/conversations(?:/[A-Za-z0-9_-]+)?")
        private val AI_CALENDAR_APPLICATION = Regex("/ai/calendar/applications/[A-Za-z0-9_-]+")
        private val SCHEDULED_MESSAGE = Regex("/scheduled-messages/[A-Za-z0-9_-]+")
        private val ASSISTANT_ACTIONS = setOf("/ai/assistant/apply", "/ai/assistant/apply-actions")
        private val FEATURES = setOf("workspaces", "categories", "channels", "messages", "home",
            "time-tracking", "schedule", "search", "habits", "nutrition", "finance", "journal",
            "reminders", "document-reminders", "templates")

        private fun allowedPath(value: String, method: String): Boolean {
            if (method !in METHODS || value.length > 8192) return false
            val uri = runCatching { URI(value) }.getOrNull() ?: return false
            val path = uri.rawPath ?: return false
            if (uri.isAbsolute || uri.rawAuthority != null || uri.rawFragment != null || !PATH.matches(path))
                return false
            return path in AUTH || path.startsWith("/auth/sessions/") ||
                path in STREAMING && method == "POST" && path == value ||
                path in ASSISTANT_ACTIONS && method == "POST" ||
                path in AI_READ && method == "GET" ||
                path == "/ai/connection" && method in setOf("POST", "DELETE") ||
                path in setOf("/ai/connection/sign-in", "/ai/connection/sign-in/finish", "/ai/calendar/applications") && method == "POST" ||
                AI_CALENDAR_APPLICATION.matches(path) && method == "PUT" ||
                path == "/ai/runs" && method in setOf("GET", "DELETE") ||
                AI_RUN.matches(path) && method in setOf("PUT", "DELETE") ||
                AI_CONVERSATION.matches(path) && method == "GET" ||
                path == "/ai/preferences" && method == "PUT" ||
                path == "/ai/prompts" && method == "POST" ||
                AI_PROMPT.matches(path) && method in setOf("PUT", "DELETE") ||
                SCHEDULED_MESSAGE.matches(path) && method in setOf("PUT", "DELETE") ||
                path == "/ai/assistant/chats" && method == "GET" ||
                path.startsWith("/ai/assistant/chats/") && method in setOf("GET", "DELETE") ||
                path.startsWith("/ai/nutrition/meals/") && path.endsWith("/picture") && method == "POST" ||
                path == "/settings/appearance" || path == "/settings/appearance/validate" ||
                path == "/settings/server" && method == "GET" ||
                path == PASSWORD_PATH && method == "PUT" ||
                path == "/wear/settings" && method in setOf("GET", "PUT") ||
                path == "/notifications/settings" ||
                path == "/notifications/android/status" && method == "GET" ||
                path == "/notifications/android/config" && method == "PUT" ||
                path == "/notifications/test" && method == "POST" ||
                path == "/version" && method == "GET" ||
                path.substringAfter('/').substringBefore('/') in FEATURES
        }
    }
}
