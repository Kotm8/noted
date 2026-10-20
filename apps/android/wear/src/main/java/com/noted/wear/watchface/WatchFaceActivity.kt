package com.noted.wear.watchface

import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class WatchFaceActivity : ComponentActivity() {
    private lateinit var installer: WatchFaceInstaller
    private lateinit var status: TextView
    private lateinit var installButton: Button
    private lateinit var activateButton: Button
    private lateinit var progress: ProgressBar
    private var slotId: String? = null
    private var busy = false
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            if (it) activate()
            else status.text = "Installed. You can select Noted from your watch's face picker."
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installer = WatchFaceInstaller(this)
        val content =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(26), dp(40), dp(26), dp(48))
            }
        setContentView(
            ScrollView(this).apply {
                setBackgroundColor(Color.rgb(8, 10, 9))
                addView(content)
            }
        )
        content.addView(
            TextView(this).apply {
                text = "Noted watch face"
                textSize = 21f
                setTextColor(Color.WHITE)
            }
        )
        status =
            TextView(this).apply {
                text = "Checking watch face..."
                textSize = 13f
                setTextColor(Color.LTGRAY)
                setPadding(0, dp(12), 0, dp(12))
            }
        content.addView(status)
        progress = ProgressBar(this)
        content.addView(progress, LinearLayout.LayoutParams(dp(26), dp(26)))
        installButton =
            Button(this).apply {
                text = "Install watch face"
                isAllCaps = false
                setOnClickListener {
                    runAction {
                        slotId = installer.install()
                        installButton.text = "Installed"
                        status.text =
                            "Ready. Use Noted now, or choose it later from your face picker."
                    }
                }
            }
        content.addView(installButton, LinearLayout.LayoutParams(-1, -2))
        activateButton =
            Button(this).apply {
                text = "Use watch face"
                isAllCaps = false
                setOnClickListener {
                    if (
                        ContextCompat.checkSelfPermission(
                            this@WatchFaceActivity,
                            WatchFaceInstaller.ACTIVATE_PERMISSION,
                        ) == PackageManager.PERMISSION_GRANTED
                    )
                        activate()
                    else permission.launch(WatchFaceInstaller.ACTIVATE_PERMISSION)
                }
            }
        content.addView(activateButton, LinearLayout.LayoutParams(-1, -2))
        content.addView(
            TextView(this).apply {
                text =
                    "Choose W07, W16, or W24 in Noted Settings > Watch on your phone. Change edge information in the face's Customize screen."
                textSize = 12f
                setTextColor(Color.GRAY)
                setPadding(0, dp(12), 0, dp(8))
            }
        )
        if (!installer.supported()) {
            status.text =
                "Installing the included face requires Wear OS 6 or newer. The Noted app still works on this watch."
            progress.visibility = View.GONE
            installButton.isEnabled = false
            activateButton.isEnabled = false
        } else
            runAction {
                val state = installer.state()
                slotId = state.slotId
                installButton.text =
                    when {
                        state.updateAvailable -> "Update watch face"
                        slotId != null -> "Installed"
                        else -> "Install watch face"
                    }
                status.text =
                    if (slotId == null) "The face is included. No extra download is needed."
                    else if (state.updateAvailable)
                        "An updated Noted face is included with this app."
                    else "Noted is installed and ready to use."
            }
    }

    private fun activate() {
        val slot = slotId ?: return
        runAction {
            installer.activate(slot)
            status.text = "Noted is now your watch face."
        }
    }

    private fun runAction(action: suspend () -> Unit) {
        if (busy) return
        busy = true
        installButton.isEnabled = false
        activateButton.isEnabled = false
        progress.visibility = View.VISIBLE
        lifecycleScope.launch {
            try {
                action()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                status.text = "${error.message ?: "Could not install the face."} Try again."
            } finally {
                busy = false
                progress.visibility = View.GONE
                installButton.isEnabled = installButton.text != "Installed"
                activateButton.isEnabled = slotId != null
            }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
