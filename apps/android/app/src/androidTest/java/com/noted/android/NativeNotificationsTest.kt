package com.noted.android

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.core.app.NotificationManagerCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.connection.AppAssociation
import com.noted.android.connection.ConnectionStore
import com.noted.android.notifications.PushNotifications
import com.noted.android.notifications.PushRegistration
import com.noted.android.notifications.PushState
import java.util.UUID
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeNotificationsTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @After
    fun clear() {
        PushRegistration.forget(context)
        ConnectionStore(context).origin = null
        NotificationManagerCompat.from(context).cancelAll()
    }

    @Test
    fun storesDeviceCredentialsEncryptedAndClearsThem() {
        val store = PushState(context)
        store.write(
            JSONObject()
                .put("origin", "https://notes.example.com")
                .put("secret", "private-device-fixture"),
        )
        assertEquals("private-device-fixture", store.read()!!.getString("secret"))
        val saved =
            context
                .getSharedPreferences("native_notifications", Context.MODE_PRIVATE)
                .all
                .toString()
        assertFalse(saved.contains("private-device-fixture"))
        assertFalse(saved.contains("notes.example.com"))
        store.clear()
        assertNull(store.read())
    }

    @Test
    fun receivesLiveFirebaseDiagnosticWhenConfigured() {
        val arguments = InstrumentationRegistry.getArguments()
        val origin = arguments.getString("firebaseOrigin")
        val ticket = arguments.getString("firebaseTicket")
        assumeTrue(!origin.isNullOrBlank() && !ticket.isNullOrBlank())
        android.os.ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation()
                    .uiAutomation
                    .executeShellCommand(
                        "pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}",
                    ),
            )
            .use { it.readBytes() }
        ConnectionStore(context).origin = origin
        AppAssociation.verify(context, origin!!)
        PushRegistration.pair(context, origin, ticket!!)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        waitFor("No real Firebase diagnostic arrived on the emulator.") {
            manager.activeNotifications.any {
                it.notification.extras.getString(android.app.Notification.EXTRA_TITLE) ==
                    "Noted Firebase test / Push test"
            }
        }
        waitFor("No planned task notification arrived.") {
            manager.activeNotifications.any {
                it.notification.extras.getString(android.app.Notification.EXTRA_TITLE) ==
                    "Time for Firebase Reading"
            }
        }
        val planned =
            manager.activeNotifications
                .first {
                    it.notification.extras.getString(android.app.Notification.EXTRA_TITLE) ==
                        "Time for Firebase Reading"
                }
                .notification
        val delayedRevision = planned.extras.getInt("noted_revision")
        val delay = planned.actions[1]
        val reply = Intent()
        android.app.RemoteInput.addResultsToIntent(
            delay.remoteInputs,
            reply,
            Bundle().apply { putCharSequence("reason", "Finishing Firebase test") },
        )
        delay.actionIntent.send(context, 0, reply)
        waitFor("No new task prompt arrived after the tested delay.") {
            manager.activeNotifications.any {
                it.notification.extras.getString(android.app.Notification.EXTRA_TITLE) ==
                    "Time for Firebase Reading" &&
                    it.notification.extras.getInt("noted_revision") > delayedRevision
            }
        }
        val repeated =
            manager.activeNotifications.first {
                it.notification.extras.getString(android.app.Notification.EXTRA_TITLE) ==
                    "Time for Firebase Reading" &&
                    it.notification.extras.getInt("noted_revision") > delayedRevision
            }
        repeated.notification.actions[0].actionIntent.send()
        waitFor("Start action did not finish.") {
            manager.activeNotifications.none { it.tag == repeated.tag }
        }
    }

    private fun waitFor(message: String, ready: () -> Boolean) {
        val deadline = android.os.SystemClock.elapsedRealtime() + 60000
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            if (ready()) return
            Thread.sleep(250)
        }
        fail(message)
    }

    @Test
    fun registersNativeMessagingAndKeepsActionReceiverPrivate() {
        val receiver =
            context.packageManager.getReceiverInfo(
                ComponentName(
                    context.packageName,
                    "com.noted.android.notifications.PushActionReceiver",
                ),
                0,
            )
        assertFalse(receiver.exported)
        val service =
            context.packageManager.getServiceInfo(
                ComponentName(
                    context.packageName,
                    "com.noted.android.notifications.NotedMessagingService",
                ),
                0,
            )
        assertFalse(service.exported)
        val link =
            Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse(
                        "noted://notifications/connect?origin=https%3A%2F%2Fnotes.example.com&ticket=fixture",
                    ),
                )
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage(context.packageName)
        assertNotNull(
            context.packageManager.resolveActivity(link, PackageManager.MATCH_DEFAULT_ONLY),
        )
    }

    @Test
    fun rendersNativeReminderActionsAndIgnoresAnotherServer() {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation()
                    .uiAutomation
                    .executeShellCommand(
                        "pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}",
                    ),
            )
            .use { it.readBytes() }
        val origin = "https://notes.example.com"
        ConnectionStore(context).origin = origin
        PushState(context)
            .write(
                JSONObject()
                    .put("origin", origin)
                    .put("secret", "fixture-secret")
                    .put("binding", "fixture-binding"),
            )
        val id = UUID.randomUUID().toString()
        val payload =
            JSONObject()
                .put("title", "Study / #reading")
                .put("body", "Read a chapter")
                .put("messageId", id)
                .put("revision", 1)
                .put("snoozeMinutes", 15)
                .put("url", "/w/project/c/channel?note=$id")
        PushNotifications.show(context, "https://other.example.com", payload)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        assertEquals(0, manager.activeNotifications.size)
        PushNotifications.show(context, origin, payload)
        waitFor("The native reminder notification was not posted.") {
            manager.activeNotifications.size == 1
        }
        val posted = manager.activeNotifications.single().notification
        assertEquals(
            "Study / #reading",
            posted.extras.getString(android.app.Notification.EXTRA_TITLE),
        )
        assertEquals(listOf("Done", "Snooze 15m"), posted.actions.map { it.title.toString() })
        NotificationManagerCompat.from(context).cancelAll()
        waitFor("The native reminder notification was not cleared.") {
            manager.activeNotifications.isEmpty()
        }
        payload
            .put("kind", "plan")
            .put("promptId", id)
            .put("plannedStart", "2026-10-19T12:00:00Z")
            .put("timezone", "UTC")
        PushNotifications.show(context, origin, payload)
        waitFor("The native planned activity notification was not posted.") {
            manager.activeNotifications.size == 1
        }
        val planned = manager.activeNotifications.single().notification
        assertEquals(
            listOf("Start", "Delay 15m", "More options"),
            planned.actions.map { it.title.toString() },
        )
        assertEquals("reason", planned.actions[1].remoteInputs.single().resultKey)
        payload.put("phase", "end").put("plannedEnd", "2026-10-19T13:00:00Z").put("revision", 2)
        PushNotifications.show(context, origin, payload)
        waitFor("The end-of-activity notification was not posted.") {
            manager.activeNotifications
                .singleOrNull()
                ?.notification
                ?.extras
                ?.getInt("noted_revision") == 2
        }
        val ended = manager.activeNotifications.single().notification
        assertEquals(
            listOf("No activity", "Snooze 15m", "More options"),
            ended.actions.map { it.title.toString() },
        )
        assertTrue(ended.actions[1].remoteInputs.isNullOrEmpty())
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            assertTrue(ended.actions[0].actionIntent.isImmutable)
            assertTrue(ended.actions[1].actionIntent.isImmutable)
        }
        NotificationManagerCompat.from(context).cancelAll()
        waitFor("The planned notification was not cleared.") {
            manager.activeNotifications.isEmpty()
        }
        val writing =
            JSONObject()
                .put("kind", "writing")
                .put("writingPromptId", UUID.randomUUID().toString())
                .put("title", "Journal / #daily")
                .put("body", "What did you learn today?")
                .put("revision", 2)
                .put("url", "/w/project/c/channel")
        PushNotifications.show(context, origin, writing)
        waitFor("The writing prompt notification was not posted.") {
            manager.activeNotifications.size == 1
        }
        val writingNotification = manager.activeNotifications.single().notification
        assertEquals(
            "Journal / #daily",
            writingNotification.extras.getString(android.app.Notification.EXTRA_TITLE),
        )
        assertTrue(writingNotification.actions.isNullOrEmpty())
    }
}
