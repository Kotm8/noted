package com.noted.android.data

import org.json.JSONObject

data class AppearancePreset(val name: String, val background: String, val sidebar: String, val text: String, val accent: String)

val appearancePresets = linkedMapOf(
    "modern" to AppearancePreset("Dark Modern", "#1f1f1f", "#181818", "#cccccc", "#e2c15a"),
    "charcoal" to AppearancePreset("Charcoal", "#1c1d1d", "#222323", "#e5e5e2", "#c4b69e"),
    "warm" to AppearancePreset("Warm", "#211f1c", "#292621", "#e8e1d6", "#c1ae8b"),
    "slate" to AppearancePreset("Slate", "#1c2024", "#24292e", "#dce1e5", "#a9bac2"),
)

fun defaultAppearance(): JSONObject = applyAppearancePreset(json("textSize" to 15, "zoom" to 100,
    "messageLayout" to "minute", "messageGroupMinutes" to 2), "modern")

fun applyAppearancePreset(value: JSONObject, key: String): JSONObject {
    val preset = appearancePresets.getValue(key)
    return value.copy().put("preset", key).put("background", preset.background).put("sidebar", preset.sidebar)
        .put("text", preset.text).put("accent", preset.accent)
}
