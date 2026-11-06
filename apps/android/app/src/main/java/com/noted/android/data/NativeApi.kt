package com.noted.android.data

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.HttpUrl.Companion.toHttpUrl
import okio.BufferedSink
import okio.source
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, override val message: String) : IOException(message)

class NativeApi(val origin: String, cookies: List<okhttp3.Cookie> = emptyList(),
    onCookies: (List<okhttp3.Cookie>) -> Unit = {}, private val unauthorized: () -> Unit = {}) {
    val jar = SessionCookies(origin.toHttpUrl(), cookies, onCookies)
    val client: OkHttpClient = OkHttpClient.Builder().cookieJar(jar)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false)
        .addInterceptor { chain ->
            val request = chain.request()
            require(sameOrigin(request.url.toString())) { "This request belongs to another server." }
            chain.proceed(request.newBuilder().header("Origin", origin)
                .header("User-Agent", "Noted-Android/Native")
                .header("X-CSRF-Token", jar.csrf()).build())
        }.build()
    val transferClient: OkHttpClient by lazy {
        client.newBuilder().callTimeout(30, TimeUnit.MINUTES).readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS).build()
    }

    fun sameOrigin(value: String): Boolean = runCatching {
        val actual = value.toHttpUrl(); val expected = origin.toHttpUrl()
        actual.scheme == expected.scheme && actual.host == expected.host && actual.port == expected.port &&
            actual.username.isEmpty() && actual.password.isEmpty()
    }.getOrDefault(false)

    fun url(path: String): String {
        require(path.startsWith("/api/v1/") && !path.contains('\\')) { "Invalid server path." }
        val url = origin + path
        require(sameOrigin(url))
        return url
    }

    suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): String =
        send(path, method, body?.toString()?.toRequestBody("application/json".toMediaType()))

    suspend fun send(path: String, method: String, body: RequestBody?, transfer: Boolean = false): String = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(url("/api/v1$path"))
            .header("Accept", "application/json").method(method,
                if (method in listOf("POST", "PUT", "PATCH")) body ?: ByteArray(0).toRequestBody() else body).build()
        (if (transfer) transferClient else client).newCall(request).await().use { response ->
            if (!response.isSuccessful) throw error(response)
            val source = response.body?.source() ?: return@use "null"
            if (source.request(8L * 1024 * 1024 + 1)) throw IOException("The server response is too large.")
            source.readUtf8().ifBlank { "null" }
        }
    }

    fun error(response: Response): ApiException {
        if (response.code == 401) unauthorized()
        val raw = response.peekBody(65536).string()
        val detail = runCatching { JSONObject(raw).opt("detail") }.getOrNull()
        val message = when (detail) {
            is String -> detail
            is JSONArray -> detail.objects().joinToString("\n") { it.text("msg", "Check the entered values.") }
            else -> "The server could not complete this request (${response.code})."
        }
        return ApiException(response.code, message)
    }

    suspend fun upload(context: Context, path: String, text: String, files: List<Uri>,
        reminder: JSONObject?, clientId: String): String {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("content", text).addFormDataPart("client_id", clientId)
        reminder?.let { body.addFormDataPart("reminder", it.toString()) }
        files.forEach { uri ->
            var name = "attachment"
            var size = -1L
            context.contentResolver.query(uri, arrayOf("_display_name", "_size"), null, null, null)?.use {
                if (it.moveToFirst()) { name = it.getString(0) ?: name; size = if (it.isNull(1)) -1 else it.getLong(1) }
            }
            require(size <= 250L * 1024 * 1024) { "Each file must be at most 250 MB." }
            val type = context.contentResolver.getType(uri) ?: "application/octet-stream"
            body.addFormDataPart("files", name, object : RequestBody() {
                override fun contentType() = type.toMediaType()
                override fun contentLength() = size
                override fun writeTo(sink: BufferedSink) {
                    context.contentResolver.openInputStream(uri)?.source()?.use { source ->
                        var total = 0L
                        while (true) {
                            val count = source.read(sink.buffer, 65536)
                            if (count < 0) break
                            total += count
                            require(total <= 250L * 1024 * 1024) { "Each file must be at most 250 MB." }
                            sink.emitCompleteSegments()
                        }
                    } ?: throw IOException("This file is no longer available. Choose it again.")
                }
            })
        }
        return withContext(Dispatchers.IO) { send(path, "POST", body.build(), transfer = true) }
    }
}

suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) {
            if (!continuation.isCancelled) continuation.resumeWithException(error)
        }
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response) { _, value, _ -> value.close() }
        }
    })
}
