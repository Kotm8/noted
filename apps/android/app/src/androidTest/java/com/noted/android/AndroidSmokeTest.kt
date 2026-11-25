package com.noted.android

import android.content.Intent
import android.content.ComponentName
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidSmokeTest {
    @Test fun opensThePackagedPhoneWithOneLauncher() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val launchers = context.packageManager.queryIntentActivities(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName), 0,
        )
        assertEquals(listOf(ComponentName(context, MainActivity::class.java).className), launchers.map { it.activityInfo.name })
        context.assets.open("public/index.html").use { assertTrue(it.read() >= 0) }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { assertNotNull(it.bridge.getPlugin("NotedPilot")) }
        }
    }

    @Test fun doesNotExposeBrowserDelegation() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val intent = Intent("android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE").setPackage(context.packageName)
        assertTrue(context.packageManager.queryIntentServices(intent, 0).isEmpty())
    }
}
