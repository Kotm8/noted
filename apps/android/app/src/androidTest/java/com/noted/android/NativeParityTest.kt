package com.noted.android

import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.*
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeParityTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val repository get() = (instrumentation.targetContext.applicationContext as NotedApplication).repository

    private fun signIn() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("nativeParity") == "true")
        runBlocking { repository.logout(); repository.login("http://localhost:8123", "native", "native-test-password-only") }
    }

    @Test fun searchOpensOldMessagesThreadRepliesAndJournalEntries() {
        signIn()
        ActivityScenario.launch(MainActivity::class.java).use { scene ->
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("Search notes").fetchSemanticsNodes().isNotEmpty() }
            listOf(
                "Older search target" to "Older search target kept beyond the first page",
                "thread reply found" to "A thread reply found through search",
                "Buried journal" to "Buried journal content found through search",
            ).forEach { (query, target) ->
                compose.onNodeWithContentDescription("Search notes").performClick()
                compose.onNodeWithContentDescription("Search notes, journals, and documents").performTextInput(query)
                compose.waitUntil(10_000) { compose.onAllNodesWithText(target, substring = true).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithText(target, substring = true).performClick()
                waitForContent(scene, target)
                instrumentation.uiAutomation.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK)
            }
        }
    }

    @Test fun libraryReachesFilesBeyondTwoHundredNotes() {
        signIn()
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("Open sidebar").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Open sidebar").performClick()
            compose.onNodeWithText("Library").performClick()
            compose.waitUntil(10_000) { compose.onAllNodes(hasText("Load more files") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Load more files").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("native-library.png").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("native-library.png").performClick()
            compose.onNodeWithContentDescription("Close viewer").assertIsDisplayed().performClick()
            compose.onNodeWithText("#little-thoughts · Open note").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Back to latest notes").fetchSemanticsNodes().isNotEmpty() }
        }
    }

    @Test fun newOwnerCanSaveNutritionProfileAndTarget() {
        signIn()
        val launch = Intent(instrumentation.targetContext, MainActivity::class.java).setData(Uri.parse("http://localhost:8123/nutrition"))
        ActivityScenario.launch<MainActivity>(launch).use {
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Set up profile").fetchSemanticsNodes().isNotEmpty() || compose.onAllNodesWithText("Daily target").fetchSemanticsNodes().isNotEmpty() }
            if (compose.onAllNodesWithText("Set up profile").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("Set up profile").performClick()
            else compose.onNodeWithText("Profile").performClick()
            compose.onNodeWithContentDescription("Age").performTextReplacement("30")
            compose.onNodeWithContentDescription("Height, cm").performTextReplacement("180")
            compose.onNodeWithContentDescription("Weight, kg").performTextReplacement("80")
            compose.onNodeWithText("Save").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Daily target").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Daily target").performClick()
            compose.onNodeWithText("Save").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("of 2000 kcal").fetchSemanticsNodes().isNotEmpty() }
            val state = runBlocking { JSONObject(repository.api.request("/nutrition")) }
            assertEquals(30, state.getJSONObject("profile").optInt("age"))
            assertEquals(2000, state.getJSONObject("target").optInt("kcal"))
        }
    }

    @Test fun assistantRestoresConversationFromAnotherDevice() {
        signIn()
        ActivityScenario.launch(MainActivity::class.java).use { scene ->
            compose.waitUntil(15_000) { compose.onAllNodesWithText("Ask AI").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Ask AI").performClick()
            waitForContent(scene, "Saved conversation from another device")
            compose.onNodeWithText("New conversation").performClick()
            compose.onNodeWithContentDescription("What would you like to do?").performTextInput("A fresh conversation")
            compose.onNodeWithContentDescription("What would you like to do?").assertTextContains("A fresh conversation")
        }
    }

    @Test fun savedMealsKeepDecimalMacrosAndAllowEditing() {
        signIn()
        val launch = Intent(instrumentation.targetContext, MainActivity::class.java).setData(Uri.parse("http://localhost:8123/nutrition"))
        ActivityScenario.launch<MainActivity>(launch).use {
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Saved meals").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Saved meals").performClick()
            compose.onNodeWithText("New saved meal").performClick()
            compose.onNodeWithContentDescription("Meal name").performTextInput("Native decimal meal")
            compose.onNodeWithText("Add food manually").performScrollTo().performClick()
            compose.onNodeWithContentDescription("Food").performScrollTo().performTextInput("Oats")
            compose.onNodeWithContentDescription("Calories").performScrollTo().performTextReplacement("150")
            compose.onNodeWithContentDescription("Protein").performScrollTo().performTextReplacement("1.5")
            compose.onNodeWithText("Save").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Food diary").fetchSemanticsNodes().isNotEmpty() }
            val saved = runBlocking { JSONObject(repository.api.request("/nutrition")).rows("saved_meals").first { it.text("name") == "Native decimal meal" } }
            assertEquals(1.5, saved.rows("items").single().getDouble("protein"), .001)
            compose.onNodeWithText("Saved meals").performClick()
            compose.onNodeWithText("Native decimal meal").performClick()
            compose.onNodeWithContentDescription("Meal name").performTextReplacement("Edited native meal")
            compose.onNodeWithText("Save").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithText("Food diary").fetchSemanticsNodes().isNotEmpty() }
            val edited = runBlocking { JSONObject(repository.api.request("/nutrition")).rows("saved_meals").first { it.text("id") == saved.text("id") } }
            assertEquals("Edited native meal", edited.text("name"))
            runBlocking { repository.mutate("/nutrition/saved-meals/${saved.text("id")}", "DELETE") }
        }
    }

    private fun waitForContent(scene: ActivityScenario<MainActivity>, text: String) {
        compose.waitUntil(10_000) {
            val inCompose = compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
            var native = false
            scene.onActivity { activity ->
                fun visit(view: View) {
                    if (view is TextView && view.text.toString().contains(text)) native = true
                    if (view is ViewGroup) for (index in 0 until view.childCount) visit(view.getChildAt(index))
                }
                visit(activity.window.decorView)
            }
            val dialog = instrumentation.uiAutomation.rootInActiveWindow?.findAccessibilityNodeInfosByText(text)?.any { it.text?.contains(text) == true } == true
            native || inCompose || dialog
        }
    }
}
