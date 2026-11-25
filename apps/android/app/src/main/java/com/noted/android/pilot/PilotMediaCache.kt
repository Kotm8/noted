package com.noted.android.pilot

import android.content.Context
import android.webkit.WebResourceResponse
import coil.annotation.ExperimentalCoilApi
import coil.disk.DiskCache
import java.io.FilterInputStream
import java.io.InputStream
import java.io.IOException
import okhttp3.Response
import okio.buffer

@OptIn(ExperimentalCoilApi::class)
internal class PilotMediaCache(context: Context) {
    private val disk = DiskCache.Builder().directory(context.cacheDir.resolve("pilot-media"))
        .maxSizeBytes(64L * 1024 * 1024).build()

    fun open(key: String): WebResourceResponse? {
        val snapshot = disk.openSnapshot(key) ?: return null
        return try {
            val fields = disk.fileSystem.read(snapshot.metadata) { readUtf8().split('\n') }
            val writtenAt = fields[1].toLong()
            val length = disk.fileSystem.metadata(snapshot.data).size ?: throw IOException("Missing cache size")
            if (System.currentTimeMillis() - writtenAt > MAX_AGE || length !in 1..MAX_IMAGE)
                throw IOException("Cached image expired")
            val mime = fields[0]
            require(mime in IMAGE_TYPES)
            val input = object : FilterInputStream(disk.fileSystem.source(snapshot.data).buffer().inputStream()) {
                override fun close() {
                    try { super.close() } finally { snapshot.close() }
                }
            }
            WebResourceResponse(mime, null, 200, "OK",
                mapOf("Content-Length" to length.toString(), "Cache-Control" to "no-store",
                    "X-Content-Type-Options" to "nosniff"), input)
        } catch (_: Exception) {
            snapshot.close()
            null
        }
    }

    fun record(key: String?, mime: String, response: Response, eligible: () -> Boolean): InputStream {
        val body = checkNotNull(response.body)
        val length = body.contentLength()
        val editor = key?.takeIf { mime in IMAGE_TYPES && length in -1..MAX_IMAGE }?.let {
            runCatching { disk.openEditor(it) }.getOrNull()
        }
        val sink = editor?.let { runCatching { disk.fileSystem.sink(it.data).buffer() }.getOrNull() }
        if (editor != null && sink == null) runCatching { editor.abort() }
        return object : FilterInputStream(body.byteStream()) {
            private var stored = 0L
            private var recording = sink != null

            private fun finish(complete: Boolean) {
                if (!recording) return
                recording = false
                val committed = runCatching {
                    sink?.close()
                    if (!complete || !eligible() || stored !in 1..MAX_IMAGE) return@runCatching false
                    val target = checkNotNull(editor)
                    disk.fileSystem.write(target.metadata) { writeUtf8("$mime\n${System.currentTimeMillis()}") }
                    target.commit()
                    true
                }.getOrDefault(false)
                if (!committed) runCatching { editor?.abort() }
            }

            private fun keep(count: Int, write: () -> Unit) {
                if (count < 0) {
                    finish(length < 0 || stored == length)
                } else if (recording) {
                    stored += count
                    if (stored > MAX_IMAGE || runCatching(write).isFailure) finish(false)
                }
            }

            override fun read(): Int {
                val value = super.read()
                keep(if (value < 0) -1 else 1) { sink?.writeByte(value) }
                return value
            }

            override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                val read = super.read(buffer, offset, count)
                keep(read) { sink?.write(buffer, offset, read) }
                return read
            }

            override fun close() {
                try {
                    finish(stored == length)
                } finally {
                    response.close()
                }
            }
        }
    }

    fun clear() = disk.clear()

    companion object {
        private const val MAX_IMAGE = 8L * 1024 * 1024
        private const val MAX_AGE = 30L * 24 * 60 * 60 * 1000
        val IMAGE_TYPES = setOf("image/webp", "image/png", "image/jpeg", "image/gif")
    }
}
