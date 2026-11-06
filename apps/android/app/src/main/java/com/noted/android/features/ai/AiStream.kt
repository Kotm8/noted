package com.noted.android.features.ai

import com.noted.android.data.NativeApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

fun NativeApi.stream(path: String, input: JSONObject): Flow<JSONObject> = callbackFlow {
    val request = Request.Builder().url(url("/api/v1$path"))
        .post(input.toString().toRequestBody("application/json".toMediaType())).build()
    val call = client.newBuilder().readTimeout(180, TimeUnit.SECONDS).callTimeout(0, TimeUnit.SECONDS).build().newCall(request)
    call.enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) { close(error) }
        override fun onResponse(call: Call, response: Response) {
            try {
                response.use {
                    if (!response.isSuccessful) throw error(response)
                    val source = response.body!!.source()
                    while (!source.exhausted()) {
                        val line = source.readUtf8LineStrict(1024L * 1024)
                        if (line.isNotBlank() && trySendBlocking(JSONObject(line)).isFailure) return
                    }
                }
                close()
            } catch (error: Exception) { close(error) }
        }
    })
    awaitClose { call.cancel() }
}
