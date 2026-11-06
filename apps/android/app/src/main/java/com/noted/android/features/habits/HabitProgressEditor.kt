package com.noted.android.features.habits

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun HabitProgressEditor(repository: NativeRepository, habit: JSONObject, progress: JSONObject?, day: String, close: () -> Unit) {
    var text by remember { mutableStateOf((progress?.optDouble("value") ?: 0.0).let {
        if (it == it.toLong().toDouble()) it.toLong().toString() else it.toString()
    }) }
    val value = text.toDoubleOrNull()?.takeIf { it.isFinite() && it in 0.0..100000.0 }
    val actions = rememberActions()
    DesignSheet(close, habit.text("name")) {
        DesignLabel("Today's ${habit.text("unit", "count")}")
        Field("Amount", text, { text = it })
        PillButton({ actions.run {
            repository.mutate("/habits/${habit.text("id")}/progress", "PUT", json("day" to day, "value" to value,
                "revision" to (progress?.optInt("revision") ?: 0)))
            close()
        } }, Modifier.fillMaxWidth().padding(top = 22.dp), primary = true, enabled = value != null && !actions.busy) { Text("Save") }
    }
}
