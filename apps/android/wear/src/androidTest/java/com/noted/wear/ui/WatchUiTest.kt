package com.noted.wear.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
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
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLStreamHandler
import java.net.URLStreamHandlerFactory
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
        URL.setURLStreamHandlerFactory(
            URLStreamHandlerFactory { protocol ->
                if (protocol != "https") null
                else
                    object : URLStreamHandler() {
                        override fun openConnection(url: URL): HttpURLConnection {
                            check(url.host == "noted-watch.test")
                            return object : HttpURLConnection(url) {
                                private val request = ByteArrayOutputStream()

                                override fun connect() = Unit

                                override fun disconnect() = Unit

                                override fun usingProxy() = false

                                override fun getOutputStream() = request

                                override fun getResponseCode() = 200

                                override fun getInputStream() =
                                    ByteArrayInputStream(snapshot.toString().toByteArray())
                            }
                        }
                    }
            },
        )
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
        click("Switch activity")
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
        instrumentation.runOnMainSync {
            activity.intent.putExtra("prompt_id", "plan-prompt")
            context.sendBroadcast(Intent("com.noted.wear.REFRESH").setPackage(context.packageName))
        }
        settle()
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
        for (y in bitmap.height * 5 / 10 until bitmap.height * 7 / 10 step 2) {
            for (x in bitmap.width / 5 until bitmap.width * 4 / 5 step 2) {
                if (android.graphics.Color.red(bitmap.getPixel(x, y)) > 80) foreground++
            }
        }
        return foreground > 40
    }

    private fun hasClock(bitmap: Bitmap): Boolean {
        var foreground = 0
        for (y in bitmap.height * 14 / 100 until bitmap.height * 27 / 100 step 2) {
            for (x in bitmap.width / 4 until bitmap.width * 3 / 4 step 2) {
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
