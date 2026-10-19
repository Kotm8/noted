package com.noted.android.notifications

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.ProgressBar
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.noted.android.MainActivity
import com.noted.android.connection.AppAssociation
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ServerAddress
import java.util.concurrent.Executors

class NotificationSetupActivity : ComponentActivity() {
    private val network = Executors.newSingleThreadExecutor()
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) pair()
            else
                fail(
                    "Notifications are blocked. Allow them in Android app settings, then enable notifications again in Noted.",
                )
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(ProgressBar(this))
        if (intent.data?.host != "notifications" || intent.data?.path != "/connect") {
            finish()
            return
        }
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        )
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        else if (!NotificationManagerCompat.from(this).areNotificationsEnabled())
            fail("Notifications are disabled for Noted. Enable them in Android app settings first.")
        else pair()
    }

    private fun pair() {
        val origin = intent.data?.getQueryParameter("origin")
        val ticket = intent.data?.getQueryParameter("ticket")
        if (
            origin == null ||
                ticket == null ||
                ticket.length !in 43..128 ||
                ConnectionStore(this).origin != origin ||
                runCatching { ServerAddress.normalize(origin) != origin }.getOrDefault(true)
        ) {
            fail(
                "This notification setup does not belong to your selected server. Open Noted and enable notifications again.",
            )
            return
        }
        network.execute {
            val result = runCatching {
                AppAssociation.verify(this, origin)
                PushRegistration.pair(this, origin, ticket)
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                result
                    .onSuccess { returnToApp() }
                    .onFailure {
                        fail(
                            it.message
                                ?: "Could not enable phone notifications. Check the Firebase setup and try again.",
                        )
                    }
            }
        }
    }

    private fun fail(message: String) {
        AlertDialog.Builder(this)
            .setTitle("Phone notifications")
            .setMessage(message)
            .setPositiveButton("Back to Noted") { _, _ -> returnToApp() }
            .setOnCancelListener { returnToApp() }
            .show()
    }

    private fun returnToApp() {
        startActivity(Intent(this, MainActivity::class.java).putExtra("notification_setup", true))
        finish()
    }

    override fun onDestroy() {
        network.shutdownNow()
        super.onDestroy()
    }
}
