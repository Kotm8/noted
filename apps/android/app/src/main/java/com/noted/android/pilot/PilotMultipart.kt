package com.noted.android.pilot

import android.content.Context
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.buffer

internal class PilotMultipart(context: Context) {
    private data class Upload(
        val id: String,
        val path: String,
        val binding: String,
        val type: MediaType,
        val file: File,
        val maximum: Long,
        var output: FileOutputStream?,
        var size: Long = 0,
    )

    private val directory = File(context.cacheDir, "pilot-transfers").apply { mkdirs() }
    private var active: Upload? = null

    init {
        directory.listFiles()?.filter { it.name.startsWith("upload-") }?.forEach { it.delete() }
    }

    @Synchronized
    fun begin(id: String, path: String, binding: String, type: String) {
        check(active == null) { "An upload is already in progress." }
        val maximum = limit(path) ?: error("This location does not accept files.")
        require(CONTENT_TYPE.matches(type))
        val file = File.createTempFile("upload-", ".part", directory)
        try {
            active = Upload(id, path, binding, type.toMediaType(), file, maximum, FileOutputStream(file))
        } catch (failure: Exception) {
            file.delete()
            throw failure
        }
    }

    @Synchronized
    fun append(id: String, binding: String?, offset: Long, encoded: String) {
        val item = active?.takeIf { it.id == id && it.binding == binding } ?: error("Upload closed.")
        val output = item.output ?: error("Upload already sent.")
        require(offset == item.size && encoded.length in 1..MAX_ENCODED)
        val data = Base64.decode(encoded, Base64.NO_WRAP)
        require(data.size in 1..CHUNK_SIZE && item.size + data.size <= item.maximum) { "These files are too large." }
        output.write(data)
        item.size += data.size
    }

    @Synchronized
    fun claim(id: String, path: String, binding: String?, progress: (Long, Long) -> Unit): RequestBody {
        val item = active?.takeIf { it.id == id && it.path == path && it.binding == binding }
            ?: error("Upload closed.")
        val output = item.output ?: error("Upload already sent.")
        require(item.size > 0)
        output.close()
        item.output = null
        val body = item.file.asRequestBody(item.type)
        return object : RequestBody() {
            override fun contentType() = item.type
            override fun contentLength() = item.size

            override fun writeTo(sink: BufferedSink) {
                var sent = 0L
                progress(sent, item.size)
                val counting = object : ForwardingSink(sink) {
                    override fun write(source: Buffer, byteCount: Long) {
                        super.write(source, byteCount)
                        sent += byteCount
                        progress(sent, item.size)
                    }
                }.buffer()
                body.writeTo(counting)
                counting.emit()
            }
        }
    }

    @Synchronized
    fun clear(id: String? = null) {
        val item = active ?: return
        if (id != null && id != item.id) return
        active = null
        runCatching { item.output?.close() }
        item.file.delete()
    }

    companion object {
        private const val CHUNK_SIZE = 64 * 1024
        private const val MAX_ENCODED = (CHUNK_SIZE + 2) / 3 * 4
        private const val OVERHEAD = 512 * 1024L
        private val CONTENT_TYPE = Regex("multipart/form-data; boundary=[A-Za-z0-9_-]{1,70}")
        private val NOTE_PATH = Regex("/(?:channels/[A-Za-z0-9_-]+/messages|messages/[A-Za-z0-9_-]+/thread)/with-files")
        private val ICON_PATH = Regex("/workspaces/[A-Za-z0-9_-]+/icon")

        fun allowed(path: String, method: String) =
            limit(path) != null && method == if (ICON_PATH.matches(path)) "PUT" else "POST"

        fun limit(path: String): Long? = when {
            path in setOf("/nutrition/photos", "/finance/photos") -> 25L * 1024 * 1024 + OVERHEAD
            ICON_PATH.matches(path) -> 5L * 1024 * 1024 + OVERHEAD
            NOTE_PATH.matches(path) -> 500L * 1024 * 1024 + OVERHEAD
            else -> null
        }
    }
}
