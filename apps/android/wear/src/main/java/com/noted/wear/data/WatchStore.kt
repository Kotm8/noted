package com.noted.wear.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

class WatchStore(context: Context) {
    private val preferences = context.getSharedPreferences("watch_connection", Context.MODE_PRIVATE)

    fun credentials(): JSONObject? =
        synchronized(lock) {
            val encrypted = preferences.getString("credentials", null) ?: return@synchronized null
            runCatching {
                    val bytes = Base64.decode(encrypted, Base64.NO_WRAP)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(
                        Cipher.DECRYPT_MODE,
                        key(),
                        GCMParameterSpec(128, bytes.copyOfRange(0, 12)),
                    )
                    JSONObject(
                        String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
                    )
                }
                .getOrNull()
        }

    fun saveCredentials(value: JSONObject) =
        synchronized(lock) {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val bytes = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
            check(
                preferences
                    .edit()
                    .clear()
                    .putString("credentials", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    .commit()
            )
        }

    fun snapshot(): JSONObject? =
        synchronized(lock) {
            preferences.getString("snapshot", null)?.let {
                runCatching { JSONObject(it) }.getOrNull()
            }
        }

    fun saveSnapshot(value: JSONObject) =
        synchronized(lock) {
            check(
                preferences
                    .edit()
                    .putString("snapshot", value.toString())
                    .putLong("synced_at", System.currentTimeMillis())
                    .commit()
            )
        }

    fun syncedAt(): Long = preferences.getLong("synced_at", 0)

    fun registeredToken(): String? = preferences.getString("registered_token", null)

    fun saveRegisteredToken(token: String) {
        preferences.edit().putString("registered_token", token).apply()
    }

    fun clear() = synchronized(lock) { preferences.edit().clear().commit() }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            ALIAS,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
            }
            .generateKey()
    }

    companion object {
        private const val ALIAS = "noted_watch_connection"
        private val lock = Any()
    }
}
