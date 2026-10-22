package com.noted.android.notifications

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject

class PushWorker(context: Context, parameters: WorkerParameters) : Worker(context, parameters) {
    override fun doWork(): Result {
        val state = PushState(applicationContext).read() ?: return Result.success()
        val origin = inputData.getString("origin") ?: return Result.failure()
        if (state.optString("origin") != origin || state.optString("secret").isBlank())
            return Result.success()
        if (inputData.getString("binding") != state.optString("binding")) return Result.success()
        return try {
            val token = inputData.getString("token")
            if (token != null) {
                PushRegistration.refresh(applicationContext, token, state.getString("binding"))
            } else {
                val action = inputData.getString("action").orEmpty()
                val plan = action.startsWith("plan_")
                val body =
                    JSONObject()
                        .put("message_id", inputData.getString("message_id"))
                        .put("action", inputData.getString("action"))
                        .put("revision", inputData.getInt("revision", 0))
                if (inputData.getString("action") == "snooze")
                    body.put("minutes", inputData.getInt("minutes", 10))
                val path =
                    if (plan) {
                        body.remove("message_id")
                        body.put(
                            "action",
                            when (action) {
                                "plan_start" -> "start"
                                "plan_stop" -> "stop"
                                else -> "delay"
                            },
                        )
                        body.put("request_id", inputData.getString("request_id"))
                        body.put("requested_at", inputData.getString("requested_at"))
                        if (action == "plan_delay")
                            body
                                .put("minutes", inputData.getInt("minutes", 5))
                                .put("reason", inputData.getString("reason"))
                        "/api/v1/notifications/android/plan-prompts/${inputData.getString("message_id")}/actions"
                    } else "/api/v1/notifications/android/actions"
                PushHttp.request(origin, path, body = body, secret = state.getString("secret"))
                inputData.getString("tag")?.let {
                    PushNotifications.cancelRevision(
                        applicationContext,
                        it,
                        inputData.getInt("revision", 0),
                    )
                }
            }
            Result.success()
        } catch (error: PushHttpException) {
            if (
                error.status == 401 &&
                    PushState(applicationContext).read()?.optString("binding") ==
                        state.optString("binding")
            )
                PushRegistration.forget(applicationContext)
            if (error.status in listOf(401, 404, 409))
                inputData.getString("tag")?.let {
                    PushNotifications.cancelRevision(
                        applicationContext,
                        it,
                        inputData.getInt("revision", 0),
                    )
                }
            if ((error.status >= 500 || error.status == 429) && runAttemptCount < 8) Result.retry()
            else Result.failure()
        } catch (_: Exception) {
            if (runAttemptCount < 8) Result.retry() else Result.failure()
        }
    }
}
