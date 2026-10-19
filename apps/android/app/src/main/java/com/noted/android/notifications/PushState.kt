package com.noted.android.notifications

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

class PushState(context: Context) {
    private val preferences =
        context.getSharedPreferences("native_notifications", Context.MODE_PRIVATE)

    fun read(): JSONObject? =
        synchronized(lock) {
            val encrypted = preferences.getString("encrypted", null) ?: return@synchronized null
            runCatching {
                val bytes = Base64.decode(encrypted, Base64.NO_WRAP)
                val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                cipher.init(
                    Cipher.DECRYPT_MODE,
                    key(),
                    GCMParameterSpec(128, bytes.copyOfRange(0, 12)),
                )
                JSONObject(
                    String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8),
                )
            }
                .getOrNull()
        }

    fun write(value: JSONObject) =
        synchronized(lock) {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val encrypted = cipher.iv + cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
            check(
                preferences
                    .edit()
                    .putString("encrypted", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .commit(),
            ) {
                "Could not save phone notification settings."
            }
        }

    fun clear() = synchronized(lock) { preferences.edit().clear().commit() }

    fun updateToken(secret: String, token: String) =
        synchronized(lock) {
            val value = read() ?: return@synchronized
            if (value.optString("secret") == secret) write(value.put("token", token))
        }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let {
            return it
        }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            .apply {
                init(
                    KeyGenParameterSpec.Builder(
                            alias,
                            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                        )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build(),
                )
            }
            .generateKey()
    }

    companion object {
        private const val alias = "noted_notification_device"
        private val lock = Any()
    }
}
