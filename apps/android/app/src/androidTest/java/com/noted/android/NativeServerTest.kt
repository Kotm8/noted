package com.noted.android

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.connection.ConnectionStore
import com.noted.android.data.*
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeServerTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val repository get() = (context.applicationContext as NotedApplication).repository

    @Test fun signsInWritesAndOpensNativeScreensAgainstTheRealServer() {
        val origin = InstrumentationRegistry.getArguments().getString("nativeOrigin")
        assumeTrue(!origin.isNullOrBlank())
        runBlocking { repository.logout() }
        ConnectionStore(context).origin = origin
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            lateinit var launchIntent: Intent
            scenario.onActivity { launchIntent = Intent(it.intent) }
            compose.onNodeWithContentDescription("Username").performTextInput("native")
            compose.onNodeWithContentDescription("Password").performTextInput("native-test-password-only")
            compose.onNodeWithContentDescription("Password").performImeAction()
            compose.waitUntil(20_000) { compose.onAllNodesWithText("Next up").fetchSemanticsNodes().isNotEmpty() }
            assertNotNull(repository.session.value)
            capture("home")
            compose.onNodeWithContentDescription("Open sidebar").performClick()
            compose.onNodeWithText("little-thoughts").performClick()
            waitForText(scenario, "A quiet place for the things worth keeping.")
            capture("channel")
            val bounds = android.graphics.Rect()
            scenario.onActivity { activity ->
                fun locate(view: View): Boolean {
                    if (view is TextView && view.text.toString().contains("A quiet place for the things worth keeping.")) return view.getGlobalVisibleRect(bounds)
                    if (view is ViewGroup) for (index in 0 until view.childCount) if (locate(view.getChildAt(index))) return true
                    return false
                }
                assertTrue(locate(activity.window.decorView))
            }
            val down = android.os.SystemClock.uptimeMillis()
            listOf(android.view.MotionEvent.ACTION_DOWN, android.view.MotionEvent.ACTION_UP).forEachIndexed { index, action ->
                android.view.MotionEvent.obtain(down, down + index * 40, action, bounds.exactCenterX(), bounds.exactCenterY(), 0).let { event ->
                    instrumentation.sendPointerSync(event); event.recycle()
                }
            }
            compose.waitForIdle()
            compose.onNodeWithContentDescription("Copy note").assertIsDisplayed()
            compose.onNodeWithContentDescription("Edit note").assertIsDisplayed()
            val sentContent = "Sent from native Android ${java.util.UUID.randomUUID()}"
            compose.onNodeWithContentDescription("Message #little-thoughts").performTextInput(sentContent)
            compose.onNodeWithContentDescription("Send note").performClick()
            waitForText(scenario, sentContent)
            val channel = runBlocking { org.json.JSONArray(repository.api.request("/channels")).objects().first { it.text("kind") == "note" } }
            compose.waitUntil(15_000) { repository.pending.value.isEmpty() && runBlocking {
                repository.cached("/channels/${channel.text("id")}/messages")?.contains(sentContent) == true
            } }
            val stored = runBlocking { repository.cached("/channels/${channel.text("id")}/messages") }
            assertNotNull(stored)
            assertTrue(stored!!.contains(sentContent))
            val encrypted = context.getSharedPreferences("native_session", Context.MODE_PRIVATE).all.toString()
            assertFalse(encrypted.contains("noted_session="))
            assertFalse(encrypted.contains("native-test-password-only"))
            scenario.onActivity { activity -> activity.startActivity(Intent(activity, MainActivity::class.java).setData(Uri.parse("$origin/habits")).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Drink water").fetchSemanticsNodes().isNotEmpty() }
            capture("habits")
            val count = compose.onAllNodes(hasText("glasses", substring = true) and hasClickAction()).onFirst()
            val before = count.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.Text].joinToString { it.text }.substringBefore(" / ").toInt()
            count.performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText("${before + 1} / 8 glasses").fetchSemanticsNodes().isNotEmpty() }
            scenario.onActivity { activity -> activity.startActivity(Intent(activity, MainActivity::class.java).setData(Uri.parse("$origin/schedule")).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Go to").fetchSemanticsNodes().isNotEmpty() }
            capture("calendar")
            compose.onNodeWithContentDescription("New plan").performClick()
            compose.onNodeWithText("Plan activity").assertIsDisplayed()
            capture("plan-editor")
            compose.onNodeWithText("Cancel").performClick()
            scenario.onActivity { it.intent = launchIntent }
        }
    }

    private fun waitForText(scenario: ActivityScenario<MainActivity>, text: String) {
        try { compose.waitUntil(15_000) {
            var found = false
            scenario.onActivity { activity ->
                fun visit(view: View) {
                    if (view is TextView && view.text.toString().contains(text)) found = true
                    if (view is ViewGroup) for (index in 0 until view.childCount) visit(view.getChildAt(index))
                }
                visit(activity.window.decorView)
            }
            found
        } } catch (failure: Throwable) {
            capture("failed-message")
            throw failure
        }
    }

    private fun capture(name: String) {
        compose.waitForIdle()
        instrumentation.waitForIdleSync()
        val presented = java.util.concurrent.CountDownLatch(1)
        instrumentation.runOnMainSync {
            android.view.Choreographer.getInstance().postFrameCallback {
                android.view.Choreographer.getInstance().postFrameCallback { presented.countDown() }
            }
        }
        assertTrue(presented.await(3, java.util.concurrent.TimeUnit.SECONDS))
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        val directory = File(context.getExternalFilesDir(null), "native-screenshots").apply { mkdirs() }
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
