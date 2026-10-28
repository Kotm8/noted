package com.noted.wear.notifications

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.noted.wear.data.WatchHttpException
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import org.json.JSONObject

class WatchActionWorker(context: Context, parameters: WorkerParameters) :
    Worker(context, parameters) {
    override fun doWork(): Result {
        if (System.currentTimeMillis() - inputData.getLong("requested_at", 0) > 3600000)
            return Result.failure()
        val store = WatchStore(applicationContext)
        if (store.credentials()?.optString("device_id") != inputData.getString("device_id"))
            return Result.success()
        val id = inputData.getString("id") ?: return Result.failure()
        val action = inputData.getString("action") ?: return Result.failure()
        val path = inputData.getString("path") ?: return Result.failure()
        val data =
            JSONObject().put("action", action).put("revision", inputData.getInt("revision", 0))
        if (action in listOf("start", "stop"))
            data.put("request_id", inputData.getString("request_id"))
        if (action == "snooze") data.put("minutes", inputData.getInt("minutes", 10))
        return try {
            WatchRepository(applicationContext).request("$path/$id/actions", data)
            runCatching { WatchRepository(applicationContext).refresh() }
            Result.success()
        } catch (error: WatchHttpException) {
            if (error.status in listOf(401, 404, 409, 422)) Result.failure() else Result.retry()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
