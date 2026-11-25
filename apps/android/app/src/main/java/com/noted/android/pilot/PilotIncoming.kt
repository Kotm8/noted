package com.noted.android.pilot

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import com.getcapacitor.JSObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONArray

internal class PilotIncoming(private val context: Context) {
    private val root = context.filesDir.resolve("noted-incoming").apply { mkdirs() }

    init {
        root.listFiles()?.filter(File::isDirectory)?.forEach { account ->
            account.listFiles()?.filter { it.extension == "part" }?.forEach(File::delete)
        }
    }

    private fun account(origin: String, owner: UUID): File {
        val key = MessageDigest.getInstance("SHA-256").digest("$origin#$owner".toByteArray())
        return root.resolve(android.util.Base64.encodeToString(key, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP))
    }

    @Synchronized
    fun stage(origin: String, owner: UUID, uris: List<Uri>): Int {
        val account = account(origin, owner).apply { mkdirs() }
        val count = account.listFiles().orEmpty().count { it.extension in TYPES.values }
        var remaining = MAX_TOTAL - root.walkTopDown().filter(File::isFile).sumOf(File::length)
        var stored = 0
        for (uri in uris.filter { it.scheme == "content" }.distinct().take((4 - count).coerceAtLeast(0))) {
            val ext = TYPES[runCatching { context.contentResolver.getType(uri) }.getOrNull()] ?: continue
            val id = UUID.randomUUID().toString()
            val temporary = account.resolve("$id.part")
            try {
                val size = context.contentResolver.openInputStream(uri)?.use { input ->
                    temporary.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        var total = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read == -1) break
                            total += read
                            require(total <= minOf(MAX_IMAGE, remaining))
                            output.write(buffer, 0, read)
                        }
                        total
                    }
                } ?: 0L
                if (size > 0 && temporary.renameTo(account.resolve("$id.$ext"))) {
                    remaining -= size
                    stored++
                }
            } catch (_: Exception) {
            } finally {
                temporary.delete()
            }
        }
        return stored
    }

    @Synchronized
    fun list(origin: String, owner: UUID): JSONArray = JSONArray(
        files(origin, owner).map { file ->
            JSObject().put("id", file.nameWithoutExtension).put("name", "Shared photo.${file.extension}")
        },
    )

    @Synchronized
    fun open(origin: String, owner: UUID, id: UUID): WebResourceResponse? {
        val file = files(origin, owner).firstOrNull { it.nameWithoutExtension == id.toString() } ?: return null
        val type = TYPES.entries.first { it.value == file.extension }.key
        return WebResourceResponse(type, null, 200, "OK",
            mapOf("Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff"), file.inputStream())
    }

    @Synchronized
    fun discard(origin: String, owner: UUID, ids: Set<String>) {
        files(origin, owner).filter { it.nameWithoutExtension in ids }.forEach(File::delete)
    }

    private fun files(origin: String, owner: UUID) =
        account(origin, owner).listFiles().orEmpty().filter { it.extension in TYPES.values }
            .sortedBy(File::lastModified)

    companion object {
        private const val MAX_IMAGE = 25L * 1024 * 1024
        private const val MAX_TOTAL = 100L * 1024 * 1024
        private val TYPES = mapOf("image/jpeg" to "jpg", "image/png" to "png", "image/webp" to "webp", "image/gif" to "gif")
    }
}
