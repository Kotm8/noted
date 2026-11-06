package com.noted.android

import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.SecretStore
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidSmokeTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun opensNativeSignInWithoutABrowserOrFirebase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        runBlocking { (context.applicationContext as NotedApplication).repository.logout() }
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText("Server address").assertIsDisplayed()
            compose.onNodeWithText("Username").assertIsDisplayed()
            compose.onNodeWithText("Password").assertIsDisplayed()
            compose.onNodeWithText("Sign in").assertIsDisplayed()
        }
    }

    @Test fun doesNotExposeBrowserDelegation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = Intent("android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE").setPackage(context.packageName)
        assertTrue(context.packageManager.queryIntentServices(intent, 0).isEmpty())
    }
}
