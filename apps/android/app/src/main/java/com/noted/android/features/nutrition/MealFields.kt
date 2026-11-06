package com.noted.android.features.nutrition

import com.noted.android.data.*
import org.json.JSONArray
import org.json.JSONObject

fun validMealItems(items: List<JSONObject>): Boolean = items.isNotEmpty() && items.all { item ->
    item.text("name").isNotBlank() && item.text("kcal").toIntOrNull()?.let { it in 0..6000 } == true &&
        listOf("protein" to 600.0, "carbs" to 900.0, "fat" to 600.0).all { (key, maximum) ->
            item.text(key, "0").toDoubleOrNull()?.let { it.isFinite() && it in 0.0..maximum } == true
        }
}

fun mealItems(items: List<JSONObject>): JSONArray {
    require(validMealItems(items)) { "Give each food a name and valid calories and macros." }
    return JSONArray(items.map { item -> item.copy().put("kcal", item.text("kcal").toInt()).apply {
        listOf("protein", "carbs", "fat").forEach { key -> put(key, item.text(key, "0").toDouble()) }
    } })
}
