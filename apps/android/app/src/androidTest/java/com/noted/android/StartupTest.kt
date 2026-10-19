package com.noted.android

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.SystemClock
import android.widget.ProgressBar
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.connection.ConnectionStore
import com.noted.android.web.StartupView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartupTest {
    @Test
    fun startupRendersTheActualLogoAndLoadingBar() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val connection = ConnectionStore(context)
        val original = connection.origin
        connection.origin = null
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            lateinit var view: StartupView
            instrumentation.runOnMainSync {
                view = StartupView(activity)
                activity.setContentView(view)
            }
            SystemClock.sleep(1100)
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync {
                val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
                view.draw(Canvas(bitmap))
                val pixels = IntArray(bitmap.width * bitmap.height)
                bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                assertTrue(pixels.count { it == Color.rgb(204, 204, 204) } > 100)
                assertTrue(pixels.count { it == Color.rgb(226, 193, 90) } > 25)
                assertTrue((view.getChildAt(1) as ProgressBar).isIndeterminate)
                assertEquals("Connecting to Noted", view.contentDescription)
                bitmap.recycle()
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            connection.origin = original
        }
    }
}
