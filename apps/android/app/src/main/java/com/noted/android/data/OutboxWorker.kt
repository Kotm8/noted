package com.noted.android.data

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.noted.android.NotedApplication

class OutboxWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result =
        if ((applicationContext as NotedApplication).repository.flush()) Result.success() else Result.retry()
}
