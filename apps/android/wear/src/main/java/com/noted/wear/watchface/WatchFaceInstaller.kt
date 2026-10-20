package com.noted.wear.watchface

import android.content.Context
import android.os.ParcelFileDescriptor
import androidx.wear.watchfacepush.WatchFacePushManager
import androidx.wear.watchfacepush.WatchFacePushManagerFactory
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class WatchFaceInstaller(context: Context) {
    private val context = context.applicationContext
    private val preferences = context.getSharedPreferences("watch_face", Context.MODE_PRIVATE)

    data class State(val slotId: String?, val updateAvailable: Boolean)

    fun supported(): Boolean = WatchFacePushManagerFactory.isSupported()

    suspend fun state(): State =
        withContext(Dispatchers.IO) {
            val installed =
                manager().listWatchFaces().installedWatchFaceDetails.find {
                    it.packageName == PACKAGE_NAME
                }
            State(
                installed?.slotId,
                installed != null && preferences.getString("digest", null) != digest(),
            )
        }

    suspend fun install(): String =
        withContext(Dispatchers.IO) {
            val manager = manager()
            val listing = manager.listWatchFaces()
            val existing = listing.installedWatchFaceDetails.find { it.packageName == PACKAGE_NAME }
            val hash = digest()
            if (existing != null && preferences.getString("digest", null) == hash) {
                return@withContext existing.slotId
            }
            check(existing != null || listing.remainingSlotCount > 0) {
                "No watch face slots are available. Remove an older Noted face and try again."
            }
            val file = File(context.cacheDir, "noted-watch-face.apk")
            try {
                context.assets.open("watchface/noted.apk").use { input ->
                    file.outputStream().use { output -> input.copyTo(output) }
                }
                val token =
                    context.assets.open("watchface/validation-token.txt").bufferedReader().use {
                        it.readText().trim()
                    }
                val installed =
                    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use {
                        if (existing == null) manager.addWatchFace(it, token)
                        else manager.updateWatchFace(existing.slotId, it, token)
                    }
                preferences.edit().putString("digest", hash).apply()
                installed.slotId
            } finally {
                file.delete()
            }
        }

    suspend fun activate(slotId: String) =
        withContext(Dispatchers.IO) { manager().setWatchFaceAsActive(slotId) }

    private fun manager(): WatchFacePushManager {
        check(supported()) { "Installing the bundled watch face requires Wear OS 6 or newer." }
        return WatchFacePushManagerFactory.createWatchFacePushManager(context)
    }

    private fun digest(): String {
        val hash = MessageDigest.getInstance("SHA-256")
        context.assets.open("watchface/noted.apk").use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val size = input.read(buffer)
                if (size < 0) break
                hash.update(buffer, 0, size)
            }
        }
        return hash.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val PACKAGE_NAME = "com.noted.android.watchfacepush.noted"
        const val ACTIVATE_PERMISSION = "com.google.wear.permission.SET_PUSHED_WATCH_FACE_AS_ACTIVE"
    }
}
