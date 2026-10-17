package com.noted.android

import android.content.Context
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.connection.AppAssociation
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidSmokeTest {
    @Test fun opensServerSetupWithoutFirebase() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.getSharedPreferences("connection", Context.MODE_PRIVATE).edit().clear().commit()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val views = ArrayList<String>()
                fun collect(view: android.view.View) {
                    if (view is android.widget.TextView) views.add(view.text.toString())
                    if (view is android.view.ViewGroup) for (index in 0 until view.childCount) collect(view.getChildAt(index))
                }
                collect(activity.window.decorView)
                assertTrue(views.contains("Server address"))
                assertTrue(views.contains("Connect"))
            }
        }
    }

    @Test fun domainAssociationRequiresTheInstalledAppCertificate() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val fingerprints = AppAssociation.certificateFingerprints(context)
        assertFalse(fingerprints.isEmpty())
        val target = JSONObject().put("namespace", "android_app")
            .put("package_name", context.packageName)
            .put("sha256_cert_fingerprints", JSONArray(fingerprints.toList()))
        val statement = JSONObject().put("relation", JSONArray(listOf("delegate_permission/common.handle_all_urls")))
            .put("target", target)
        assertTrue(AppAssociation.accepts(JSONArray().put(statement), context.packageName, fingerprints))
        assertFalse(AppAssociation.accepts(JSONArray().put(statement), "com.other.app", fingerprints))
        assertFalse(AppAssociation.accepts(JSONArray().put(statement), context.packageName, setOf("WRONG:CERTIFICATE")))
        assertFalse(AppAssociation.accepts(JSONArray(), context.packageName, fingerprints))
    }

    @Test fun exposesChromeDelegationAndRoutesNotificationLinks() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val service = Intent("android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE")
            .setPackage(context.packageName)
        val resolved = context.packageManager.queryIntentServices(service, 0)
        assertTrue(resolved.any { it.serviceInfo.name.endsWith("NotedDelegationService") })
        val link = Intent(Intent.ACTION_VIEW, Uri.parse("https://notes.example.com/w/project/c/channel"))
            .addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context.packageName)
        assertNotNull(context.packageManager.resolveActivity(link, PackageManager.MATCH_DEFAULT_ONLY))
        val permissionActivity = context.packageManager.getActivityInfo(ComponentName(context.packageName,
            "com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity"), 0)
        assertTrue(permissionActivity.enabled)
        assertFalse(permissionActivity.exported)
    }
}
