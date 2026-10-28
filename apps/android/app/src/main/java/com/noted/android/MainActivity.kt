package com.noted.android

import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.widget.ScrollView
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.noted.android.connection.AppAssociation
import com.noted.android.connection.ConnectionStore
import com.noted.android.connection.ConnectionView
import com.noted.android.connection.ServerAddress
import com.noted.android.web.BrowserSession
import com.noted.android.web.StartupView
import com.noted.android.notifications.PushRegistration
import com.noted.android.notifications.PushState
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private lateinit var store: ConnectionStore
    private lateinit var browser: BrowserSession
    private val network = Executors.newSingleThreadExecutor()
    private var browserLaunched = false
    private var connecting = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        store = ConnectionStore(this)
        browser = BrowserSession(this)
        root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(31, 31, 31)) }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            insets
        }
        route(intent)
    }

    private fun route(incoming: Intent) {
        browserLaunched = false
        val target = incoming.data
        val origin = store.origin
        if (target?.scheme == "noted" && target.host == "connection") {
            PushRegistration.forget(this)
            browserLaunched = false
            showConnection()
        } else if (origin == null) {
            showConnection()
        } else if (target == null || ServerAddress.owns(origin, target.toString())) {
            connect(origin, target ?: Uri.parse(origin))
        } else {
            showConnection()
            AlertDialog.Builder(this).setMessage("This link belongs to a different server. Enter its address to connect.")
                .setPositiveButton("OK", null).show()
        }
    }

    /** The browser splash replaces the content view, so the root may need re-attaching. */
    private fun show(view: View) {
        if (root.parent == null) setContentView(root)
        root.removeAllViews()
        root.addView(view, FrameLayout.LayoutParams(-1, -1))
    }

    private fun showConnection() {
        val setup = ConnectionView(this, store.origin) { origin -> connect(origin, Uri.parse(origin)) }
        show(ScrollView(this).apply {
            isFillViewport = true
            addView(setup, FrameLayout.LayoutParams(-1, -2))
        })
    }

    private fun connect(origin: String, destination: Uri) {
        if (connecting) return
        connecting = true
        show(StartupView(this))
        network.execute {
            val result = runCatching {
                AppAssociation.verify(this, origin)
                val old = PushState(this).read()
                if (old != null && old.optString("origin") != origin) PushRegistration.disconnect(this)
            }
            runOnUiThread {
                connecting = false
                if (isFinishing || isDestroyed) return@runOnUiThread
                result.onSuccess {
                    store.origin = origin
                    val target = if (intent.getBooleanExtra("notification_setup", false)) Uri.parse("$origin/?notificationSetup=complete") else destination
                    val url = target.buildUpon().appendQueryParameter("client", "android").appendQueryParameter("nativePush", "1").build()
                    browser.open(url) { browserLaunched = true }
                }.onFailure { error ->
                    showConnection()
                    AlertDialog.Builder(this).setTitle("Couldn't connect")
                        .setMessage(error.message ?: "Check your connection, server address, and HTTPS certificate.")
                        .setPositiveButton("OK", null).show()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        route(intent)
    }

    override fun onResume() {
        super.onResume()
        if (browserLaunched) finish()
    }

    override fun onDestroy() {
        browser.close()
        network.shutdownNow()
        super.onDestroy()
    }
}
