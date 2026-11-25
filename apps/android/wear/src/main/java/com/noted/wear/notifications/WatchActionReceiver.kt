package com.noted.wear.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.noted.wear.data.WatchStore
import java.util.UUID

class WatchActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val saved = WatchStore(context).credentials() ?: return
        if (saved.optString("device_id") != intent.getStringExtra("device_id")) return
        val id = intent.getStringExtra("id") ?: return
        if (runCatching { UUID.fromString(id) }.isFailure) return
        val path =
            intent.getStringExtra("path")?.takeIf { it in listOf("prompts", "reminders") } ?: return
        val action =
            intent.getStringExtra("action")?.takeIf {
                it in listOf("start", "stop", "done", "snooze")
            } ?: return
        if ((path == "prompts") != (action in listOf("start", "stop"))) return
        val data =
            Data.Builder()
                .putString("device_id", saved.getString("device_id"))
                .putString("id", id)
                .putString("path", path)
                .putString("action", action)
                .putInt("revision", intent.getIntExtra("revision", 0))
                .putInt("minutes", intent.getIntExtra("minutes", 10))
                .putString("request_id", UUID.randomUUID().toString())
                .putLong("requested_at", System.currentTimeMillis())
                .build()
        val work =
            OneTimeWorkRequestBuilder<WatchActionWorker>()
                .setInputData(data)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(
                "watch-$id-${data.getInt("revision", 0)}-$action",
                ExistingWorkPolicy.KEEP,
                work,
            )
    }
}
