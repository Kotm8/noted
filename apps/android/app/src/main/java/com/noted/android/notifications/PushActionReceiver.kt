package com.noted.android.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.UUID
import java.util.concurrent.TimeUnit

class PushActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val origin = intent.getStringExtra("origin") ?: return
        val action = intent.getStringExtra("action") ?: return
        if (action !in listOf("done", "snooze", "plan_start", "plan_delay")) return
        val id =
            intent.getStringExtra(if (action.startsWith("plan_")) "prompt_id" else "message_id")
                ?: return
        if (runCatching { UUID.fromString(id) }.isFailure) return
        val reason =
            RemoteInput.getResultsFromIntent(intent)
                ?.getCharSequence("reason")
                ?.toString()
                ?.trim()
                ?.take(500)
        if (action == "plan_delay" && reason.isNullOrBlank()) return
        val revision = intent.getIntExtra("revision", 0)
        if (revision <= 0) return
        val data =
            Data.Builder()
                .putString("origin", origin)
                .putString("message_id", id)
                .putString("binding", intent.getStringExtra("binding"))
                .putString("action", action)
                .putInt("revision", revision)
                .putString("reason", reason)
                .putString("request_id", UUID.randomUUID().toString())
                .putString("requested_at", java.time.Instant.now().toString())
                .putInt("minutes", intent.getIntExtra("minutes", 10))
                .putString("tag", intent.getStringExtra("tag"))
                .build()
        val work =
            OneTimeWorkRequestBuilder<PushWorker>()
                .setInputData(data)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("noted-action:$origin:$id:$revision", ExistingWorkPolicy.KEEP, work)
    }
}
