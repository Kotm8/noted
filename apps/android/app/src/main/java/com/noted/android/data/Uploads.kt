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

suspend fun NativeApi.uploadFile(context: Context, path: String, uri: Uri, method: String = "POST", maxBytes: Long = 5L * 1024 * 1024): String = withContext(Dispatchers.IO) {
    var name = "image"
    var size = -1L
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
        if (it.moveToFirst()) { name = it.getString(0) ?: name; if (!it.isNull(1)) size = it.getLong(1) }
    }
    require(size <= maxBytes) { "Choose a file no larger than ${maxBytes / 1024 / 1024} MB." }
    val type = context.contentResolver.getType(uri) ?: "application/octet-stream"
    val body = object : RequestBody() {
        override fun contentType() = type.toMediaType()
        override fun contentLength() = size
        override fun writeTo(sink: BufferedSink) {
            context.contentResolver.openInputStream(uri)?.source()?.use { source ->
                var total = 0L
                while (true) {
                    val count = source.read(sink.buffer, 65536)
                    if (count < 0) break
                    total += count
                    require(total <= maxBytes) { "Choose a file no larger than ${maxBytes / 1024 / 1024} MB." }
                    sink.emitCompleteSegments()
                }
            } ?: error("This file is no longer available. Choose it again.")
        }
    }
    send(path, method, MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("file", name, body).build(), transfer = true)
}
