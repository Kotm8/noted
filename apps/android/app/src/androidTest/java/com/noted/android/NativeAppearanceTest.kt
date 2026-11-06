package com.noted.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.*
import com.noted.android.ui.appearancePalette
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAppearanceTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun customPalettesDeriveEverySurfaceAndKeepDarkAccentsReadable() {
        val dark = appearancePalette(json("background" to "#211f1c", "sidebar" to "#292621", "text" to "#e8e1d6", "accent" to "#164e63"))
        val defaults = appearancePalette(null)
        assertNotEquals(defaults.hover, dark.hover)
        assertNotEquals(defaults.subtle, dark.subtle)
        assertNotEquals(defaults.code, dark.code)
        assertTrue(dark.accentText.red > .9f)
        assertTrue(defaults.accentText.red < .2f)
        val preset = applyAppearancePreset(defaultAppearance().put("zoom", 125), "warm")
        assertEquals("#211f1c", preset.text("background"))
        assertEquals("#c1ae8b", preset.text("accent"))
        assertEquals(125, preset.optInt("zoom"))
    }

    @Test fun appearanceChangedOnTheServerRefreshesTheOpenNativeScreen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val repository = (instrumentation.targetContext.applicationContext as NotedApplication).repository
        assumeTrue(InstrumentationRegistry.getArguments().getString("nativeAppearance") == "true" && repository.session.value?.origin == "http://localhost:8123")
        val previous = runBlocking { repository.api.request("/settings/appearance").let { if (it == "null") defaultAppearance() else JSONObject(it) } }
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Next up").fetchSemanticsNodes().isNotEmpty() }
            try {
                runBlocking { repository.api.request("/settings/appearance", "PUT", json("background" to "#25221f", "accent" to "#b8cc9b", "textSize" to 17, "zoom" to 110)) }
                compose.waitUntil(10_000) { runBlocking { repository.cached("/settings/appearance")?.contains("#b8cc9b") == true } }
                compose.waitForIdle()
                val shot = instrumentation.uiAutomation.takeScreenshot()
                try {
                    assertEquals(android.graphics.Color.parseColor("#25221f"), shot.getPixel(12, shot.height / 2))
                } finally { shot.recycle() }
            } finally {
                runBlocking { repository.api.request("/settings/appearance", "PUT", previous) }
                compose.waitUntil(10_000) { runBlocking { repository.cached("/settings/appearance")?.contains("#b8cc9b") != true } }
            }
        }
    }
}
