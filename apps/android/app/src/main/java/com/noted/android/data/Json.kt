package com.noted.android.data

import org.json.JSONArray
import org.json.JSONObject

fun json(vararg fields: Pair<String, Any?>): JSONObject = JSONObject().apply {
    fields.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONObject.rows(key: String): List<JSONObject> = optJSONArray(key)?.objects().orEmpty()
fun JSONObject.text(key: String, fallback: String = ""): String =
    if (isNull(key)) fallback else optString(key, fallback)
fun JSONObject.copy(): JSONObject = JSONObject(toString())
