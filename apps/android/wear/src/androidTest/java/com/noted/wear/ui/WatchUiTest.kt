package com.noted.wear.ui

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.wear.data.WatchStore
import com.noted.wear.surfaces.FaceRenderer
import com.noted.wear.surfaces.SurfaceUpdates
import com.noted.wear.watchface.WatchFaceInstaller
import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WatchUiTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val store = WatchStore(context)
    private val phase = InstrumentationRegistry.getArguments().getString("phase", "current")
    private val output =
        File(context.getExternalFilesDir(null), "watch-ui/$phase").apply { mkdirs() }
    private lateinit var activity: WatchActivity
    private lateinit var snapshot: JSONObject

    @Test
    fun roundScreensAndWatchFaces() {
        check(Build.HARDWARE in listOf("ranchu", "goldfish")) {
            "The visual fixture must only run on a disposable emulator."
        }
        snapshot = WatchUiFixtures.snapshot()
        snapshot
            .getJSONObject("settings")
            .put(
                "text_scale",
                InstrumentationRegistry.getArguments().getString("text_scale", "1.0").toDouble(),
            )
        FakeServer.install()
        FakeServer.respond = { _, _ -> 200 to snapshot.toString() }
        store.saveCredentials(
            JSONObject()
                .put("origin", "https://noted-watch.test")
                .put("device_id", "emulator-fixture")
                .put("secret", "emulator-fixture-only"),
        )
        store.saveSnapshot(snapshot)
        shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        activity =
            instrumentation.startActivitySync(
                Intent(context, WatchActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            ) as WatchActivity
        settle()
        capture("home")
        click("Switch")
        capture("activities")
        back()
        click("Walk outside, ${WatchUiFixtures.planTime()}")
        capture("plan")
        back()
        click("Drink water, ${WatchUiFixtures.reminderTime()} / daily")
        capture("reminder")
        back()
        click("Watch settings")
        capture("settings")
        back()
        snapshot.getJSONArray("prompts").put(WatchUiFixtures.prompt())
        store.saveSnapshot(snapshot)
        open(Intent().putExtra("prompt_id", WatchUiFixtures.PROMPT_ID))
        capture("prompt")
        click("Delay prompt")
        capture("delay")
        click("15 minutes")
        click("Finishing up current task")
        capture("delay-reason")
        back()
        for (face in listOf("W07", "W16", "W24")) {
            snapshot.getJSONObject("settings").put("face", face)
            store.saveSnapshot(snapshot)
            File(output, "$face-agenda.png").outputStream().use {
                FaceRenderer.render(snapshot).compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
        snapshot.getJSONObject("settings").put("face", "W16")
        store.saveSnapshot(snapshot)
        val installer = WatchFaceInstaller(context)
        assertTrue("Wear OS 6 Watch Face Push must be available", installer.supported())
        val installed = runBlocking { installer.state() }
        val slot = runBlocking { installer.install() }
        shell("pm grant ${context.packageName} ${WatchFaceInstaller.ACTIVATE_PERMISSION}")
        if (installed.slotId == null) runBlocking { installer.activate(slot) }
        SurfaceUpdates.request(context)
        instrumentation.runOnMainSync { activity.finish() }
        shell("input keyevent KEYCODE_HOME")
        shell("input keyevent KEYCODE_BACK")
        SystemClock.sleep(4000)
        wakeFace()
        capture("face-W16")
        for (face in listOf("W07", "W24")) {
            snapshot.getJSONObject("settings").put("face", face)
            store.saveSnapshot(snapshot)
            SurfaceUpdates.request(context)
            SystemClock.sleep(2500)
            wakeFace()
            capture("face-$face")
        }
    }

    /** Notification taps on a real activity: confirm, fail and retry, outdated, diagnostics. */
    @Test
    fun notificationTapsOpenTheRightScreen() {
        check(Build.HARDWARE in listOf("ranchu", "goldfish")) {
            "The visual fixture must only run on a disposable emulator."
        }
        snapshot = WatchUiFixtures.snapshot()
        snapshot.getJSONArray("prompts").put(WatchUiFixtures.prompt())
        var actions = 0
        var actionStatus = -1
        var promptStatus = "started"
        val testId = "5d9e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70"
        FakeServer.install()
        FakeServer.respond = { path, method ->
            when {
                path.endsWith("/actions") -> {
                    actions++
                    actionStatus to snapshot.toString()
                }
                path.endsWith("/prompts/${WatchUiFixtures.OLD_PROMPT_ID}") ->
                    200 to
                        WatchUiFixtures.prompt()
                            .put("id", WatchUiFixtures.OLD_PROMPT_ID)
                            .put("status", promptStatus)
                            .toString()
                path.endsWith("/push/test") && method == "POST" ->
                    200 to JSONObject().put("test_id", testId).put("outcome", "accepted").toString()
                else -> 200 to snapshot.toString()
            }
        }
        store.saveCredentials(
            JSONObject()
                .put("origin", "https://noted-watch.test")
                .put("device_id", "emulator-fixture")
                .put("secret", "emulator-fixture-only"),
        )
        store.saveSnapshot(snapshot)
        shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        activity =
            instrumentation.startActivitySync(
                Intent(context, WatchActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            ) as WatchActivity
        settle()

        // Start tapped while the server can't be reached: nothing claims success.
        tap(command(revision = 1))
        waitFor("Try again")
        assertTrue(shows("Couldn't reach your server."))
        capture("command-failed")
        actionStatus = 200
        click("Try again")
        waitFor("Started ")
        capture("command-started")
        assertTrue("Retry must reuse the request", actions == 2)
        waitFor("TRACKING", timeout = 6000)

        // The same notification delivered again must not send a second command.
        tap(command(revision = 1))
        SystemClock.sleep(1500)
        assertTrue("A replayed tap must not run again", actions == 2)

        // An older notification for a prompt that was answered elsewhere.
        promptStatus = "started"
        tap(Intent().putExtra("prompt_id", WatchUiFixtures.OLD_PROMPT_ID))
        waitFor("ALREADY STARTED")
        capture("outdated-started")
        promptStatus = "superseded"
        tap(Intent().putExtra("prompt_id", WatchUiFixtures.OLD_PROMPT_ID).putExtra("delay", true))
        waitFor("PLAN ENDED")
        capture("outdated-ended")
        click("Home")

        // Diagnostics: the watch only reports success once the test arrives.
        click("Watch settings")
        click("Diagnostics")
        waitFor("Send test notification")
        capture("diagnostics")
        click("Send test notification")
        waitFor("Sent. Waiting…")
        store.saveTestArrival(testId)
        waitFor("✓ Arrived")
        capture("diagnostics-arrived")
    }

    private fun command(revision: Int) =
        Intent()
            .setData(Uri.parse("noted-watch://command/${WatchUiFixtures.PROMPT_ID}/$revision"))
            .putExtra("prompt_id", WatchUiFixtures.PROMPT_ID)
            .putExtra("action", "start")
            .putExtra("revision", revision)

    /** Sends the intent the way the system does when a notification is tapped. */
    private fun tap(intent: Intent) {
        PendingIntent.getActivity(
                context,
                0,
                intent
                    .setClass(context, WatchActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            .send()
        settle()
    }

    private fun open(intent: Intent) {
        tap(intent)
    }

    private fun shows(text: String): Boolean {
        var found = false
        instrumentation.runOnMainSync {
            found =
                views(activity.window.decorView).any {
                    it is TextView && it.isShown && it.text.toString().contains(text)
                }
        }
        return found
    }

    private fun waitFor(text: String, timeout: Long = 8000) {
        val until = SystemClock.uptimeMillis() + timeout
        while (!shows(text)) {
            check(SystemClock.uptimeMillis() < until) { "Never showed: $text" }
            SystemClock.sleep(150)
        }
        settle()
    }

    private fun capture(name: String) {
        var screenshot = instrumentation.uiAutomation.takeScreenshot()
        if (name.startsWith("face-")) {
            for (attempt in 0 until 8) {
                if (hasAgenda(screenshot) && hasClock(screenshot)) break
                screenshot.recycle()
                SystemClock.sleep(500)
                screenshot = instrumentation.uiAutomation.takeScreenshot()
            }
        }
        File(output, "$name.png").outputStream().use {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        if (name.startsWith("face-")) {
            assertTrue("Watch face must render agenda content: $name", hasAgenda(screenshot))
            assertTrue(
                "Watch face must retain its clock after updates: $name",
                hasClock(screenshot),
            )
        }
        screenshot.recycle()
    }

    private fun hasAgenda(bitmap: Bitmap): Boolean {
        var foreground = 0
        // Layouts place their content differently, so look across the whole dial.
        for (y in bitmap.height / 5 until bitmap.height * 4 / 5 step 2) {
            for (x in bitmap.width / 5 until bitmap.width * 4 / 5 step 2) {
                if (android.graphics.Color.red(bitmap.getPixel(x, y)) > 80) foreground++
            }
        }
        return foreground > 40
    }

    private fun hasClock(bitmap: Bitmap): Boolean {
        var foreground = 0
        for (y in bitmap.height / 10 until bitmap.height * 9 / 10 step 2) {
            for (x in bitmap.width / 10 until bitmap.width * 9 / 10 step 2) {
                val pixel = bitmap.getPixel(x, y)
                if (
                    android.graphics.Color.red(pixel) > 150 &&
                        android.graphics.Color.green(pixel) > 150
                )
                    foreground++
            }
        }
        return foreground > 100
    }

    private fun click(label: String) {
        lateinit var target: View
        instrumentation.runOnMainSync {
            val view =
                views(activity.window.decorView).firstOrNull {
                    it.isClickable &&
                        (it.contentDescription?.toString() == label ||
                            (it is TextView && it.text.toString() == label))
                }
            target = checkNotNull(view) { "Missing control: $label" }
            val bounds = Rect()
            target.getDrawingRect(bounds)
            target.requestRectangleOnScreen(bounds, true)
        }
        instrumentation.waitForIdleSync()
        val bounds = Rect()
        instrumentation.runOnMainSync { assertTrue(target.getGlobalVisibleRect(bounds)) }
        val at = SystemClock.uptimeMillis()
        instrumentation.sendPointerSync(
            MotionEvent.obtain(
                at,
                at,
                MotionEvent.ACTION_DOWN,
                bounds.exactCenterX(),
                bounds.exactCenterY(),
                0,
            ),
        )
        instrumentation.sendPointerSync(
            MotionEvent.obtain(
                at,
                at + 80,
                MotionEvent.ACTION_UP,
                bounds.exactCenterX(),
                bounds.exactCenterY(),
                0,
            ),
        )
        settle()
    }

    private fun back() {
        instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        settle()
    }

    private fun wakeFace() {
        shell("input keyevent KEYCODE_STEM_PRIMARY")
        shell("input keyevent KEYCODE_BACK")
        SystemClock.sleep(750)
    }

    private fun shell(command: String) {
        ParcelFileDescriptor.AutoCloseInputStream(
                instrumentation.uiAutomation.executeShellCommand(command),
            )
            .use { it.readBytes() }
    }

    private fun settle() {
        instrumentation.waitForIdleSync()
        SystemClock.sleep(350)
        instrumentation.waitForIdleSync()
    }

    private fun views(view: View): Sequence<View> = sequence {
        yield(view)
        if (view is ViewGroup)
            for (index in 0 until view.childCount) yieldAll(views(view.getChildAt(index)))
    }
}
