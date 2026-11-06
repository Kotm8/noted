package com.noted.android.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import java.io.IOException

suspend fun NativeApi.uploadFile(context: Context, path: String, uri: Uri, method: String = "POST", maxBytes: Long = 5L * 1024 * 1024): String = withContext(Dispatchers.IO) {
    var name = "image"
    var size = -1L
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
        if (it.moveToFirst()) { name = it.getString(0) ?: name; if (!it.isNull(1)) size = it.getLong(1) }
    }
    require(size <= maxBytes) { "Choose a file no larger than ${maxBytes / 1024 / 1024} MB." }
    val readable = try { context.contentResolver.openInputStream(uri)?.also { it.close() } } catch (_: SecurityException) { null }
    requireNotNull(readable) { "Noted can't open this file. Choose it again." }
    val type = context.contentResolver.getType(uri) ?: "application/octet-stream"
    val body = object : RequestBody() {
        override fun contentType() = type.toMediaType()
        override fun contentLength() = size
        /** OkHttp only reports IOExceptions to the caller; anything else thrown here would crash the app. */
        override fun writeTo(sink: BufferedSink) {
            val source = try { context.contentResolver.openInputStream(uri)?.source() } catch (denied: SecurityException) { throw IOException("Noted can't open this file. Choose it again.", denied) }
                ?: throw IOException("This file is no longer available. Choose it again.")
            source.use {
                var total = 0L
                while (true) {
                    val count = it.read(sink.buffer, 65536)
                    if (count < 0) break
                    total += count
                    if (total > maxBytes) throw IOException("Choose a file no larger than ${maxBytes / 1024 / 1024} MB.")
                    sink.emitCompleteSegments()
                }
            }
        }
    }
    send(path, method, MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", name, body).build(), transfer = true)
}
