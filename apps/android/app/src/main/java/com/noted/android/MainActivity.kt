package com.noted.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.content.IntentCompat
import androidx.core.view.WindowCompat
import com.noted.android.ui.NotedApp
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val destination = MutableStateFlow<Uri?>(null)
    private val sharedPhotos = MutableStateFlow<List<Uri>>(emptyList())

    override fun onResume() {
        super.onResume()
        com.noted.android.notifications.NotificationSyncWorker.enqueue(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        if (savedInstanceState == null) receive(intent)
        setContent { NotedApp((application as NotedApplication).repository, destination, sharedPhotos) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        receive(intent)
    }

    /**
     * Log meal links carry a timestamp because the destination is a StateFlow, which would ignore the
     * shortcut's identical link the second time. Shared pictures open the same Log meal flow.
     */
    private fun receive(intent: Intent) {
        val photos = when (intent.action) {
            Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            else -> emptyList()
        }
        if (photos.isNotEmpty()) sharedPhotos.value = photos.take(4)
        val data = intent.data
        destination.value = when {
            photos.isNotEmpty() || (data?.scheme == "noted" && data.host == "log-meal") -> Uri.parse("noted://log-meal?at=${System.nanoTime()}")
            else -> data
        }
    }
}
