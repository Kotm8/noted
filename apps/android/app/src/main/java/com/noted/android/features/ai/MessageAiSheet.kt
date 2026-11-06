package com.noted.android.features.ai

import androidx.compose.runtime.Composable
import com.noted.android.data.NativeRepository
import org.json.JSONObject

@Composable
fun MessageAiSheet(repository: NativeRepository, message: JSONObject, close: () -> Unit) {
    AssistantSheet(repository, true, close, message)
}
