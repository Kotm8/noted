package com.noted.android.connection

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

object AppAssociation {
    fun certificateFingerprints(context: Context): Set<String> {
        val manager = context.packageManager
        val signatures = if (Build.VERSION.SDK_INT >= 28) {
            manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                .signingInfo?.apkContentsSigners.orEmpty()
        } else {
            manager.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures.orEmpty()
        }
        return signatures.map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
                .joinToString(":") { "%02X".format(it) }
        }.toSet()
    }

    fun verify(context: Context, origin: String) {
        val connection = URI("$origin/.well-known/assetlinks.json").toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.setRequestProperty("Accept", "application/json")
            check(connection.responseCode == 200) { "Update this server to a release that supports the Android app." }
            val statements = connection.inputStream.use { input ->
                val bytes = ByteArrayOutputStream()
                val buffer = ByteArray(4096)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    check(bytes.size() + count <= 65536) { "The server's Android verification file is too large." }
                    bytes.write(buffer, 0, count)
                }
                JSONArray(bytes.toString("UTF-8"))
            }
            check(accepts(statements, context.packageName, certificateFingerprints(context))) {
                "This server doesn't recognize this APK's signing certificate. Use the app and server from the same Noted release."
            }
        } finally {
            connection.disconnect()
        }
    }

    fun accepts(statements: JSONArray, packageName: String, certificates: Set<String>): Boolean {
        for (index in 0 until statements.length()) {
            val statement = statements.optJSONObject(index) ?: continue
            val relations = statement.optJSONArray("relation") ?: continue
            if ((0 until relations.length()).none { relations.optString(it) == "delegate_permission/common.handle_all_urls" }) continue
            val target = statement.optJSONObject("target") ?: continue
            if (target.optString("namespace") != "android_app" || target.optString("package_name") != packageName) continue
            val fingerprints = target.optJSONArray("sha256_cert_fingerprints") ?: continue
            if ((0 until fingerprints.length()).any { fingerprints.optString(it).uppercase() in certificates }) return true
        }
        return false
    }
}
