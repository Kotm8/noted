package com.noted.wear.notifications

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.noted.wear.data.WatchHttpException
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import java.util.concurrent.TimeUnit

class WatchSyncWorker(context: Context, parameters: WorkerParameters) :
    Worker(context, parameters) {
    override fun doWork(): Result {
        if (WatchStore(applicationContext).credentials() == null) return Result.success()
        return try {
            WatchRepository(applicationContext).refresh()
            Result.success()
        } catch (error: WatchHttpException) {
            if (error.status == 401) Result.success() else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        fun schedule(context: Context) {
            val request =
                PeriodicWorkRequestBuilder<WatchSyncWorker>(15, TimeUnit.MINUTES)
                    .setConstraints(
                        Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                    )
                    .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(
                    "noted-watch-sync",
                    ExistingPeriodicWorkPolicy.KEEP,
                    request,
                )
        }
    }
}
