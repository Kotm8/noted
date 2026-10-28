package com.noted.wear.ui

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.noted.wear.data.WatchData
import com.noted.wear.navigation.NotificationExtras
import com.noted.wear.navigation.WatchDestination
import com.noted.wear.navigation.WatchIntentRouter
import com.noted.wear.notifications.WatchPush
import com.noted.wear.ui.screens.activities
import com.noted.wear.ui.screens.command
import com.noted.wear.ui.screens.delay
import com.noted.wear.ui.screens.diagnostics
import com.noted.wear.ui.screens.home
import com.noted.wear.ui.screens.outdated
import com.noted.wear.ui.screens.plan
import com.noted.wear.ui.screens.prompt
import com.noted.wear.ui.screens.reminder
import com.noted.wear.ui.screens.settings
import com.noted.wear.ui.screens.upcomingList
import com.noted.wear.watchface.WatchFaceActivity
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.launch

/**
 * Hosts the watch app: routes launch and notification intents, keeps the clock
 * and timer ticking, and draws whichever screen the view model's state names.
 */
class WatchActivity : ComponentActivity() {
    private val model: WatchViewModel by viewModels()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var content: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var clock: TextView
    private lateinit var backButton: ImageView
    private var elapsedView: TextView? = null
    private var rendered: String? = null
    private var visible = false
    private var lastCommand: CommandState? = null
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            WatchPush.scheduleRegistration(this)
        }
    private val receiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                model.load()
                model.refresh()
            }
        }
    private val tick =
        object : Runnable {
            override fun run() {
                if (!visible) return
                clock.text = DateTimeFormatter.ofPattern("HH:mm").format(java.time.LocalTime.now())
                model.state.value.snapshot?.let { snapshot ->
                    elapsedView?.text = WatchData.duration(snapshot.tracker.elapsed())
                }
                handler.postDelayed(this, 1000)
            }
        }
    private val poll =
        object : Runnable {
            override fun run() {
                if (!visible) return
                if (model.state.value.destination == WatchDestination.Home) model.refresh()
                handler.postDelayed(this, 20000)
            }
        }
    private val returnHome = Runnable { model.open(WatchDestination.Home) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(8, 10, 9)) }
        scroll = RoundScrollView(this)
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(content)
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        clock =
            TextView(this).apply {
                textSize = 10f
                gravity = Gravity.CENTER
                setTextColor(Color.LTGRAY)
                setBackgroundColor(Color.rgb(8, 10, 9))
            }
        root.addView(
            clock,
            FrameLayout.LayoutParams(dp(70), dp(25), Gravity.TOP or Gravity.CENTER_HORIZONTAL)
                .apply { topMargin = dp(5) },
        )
        backButton =
            ImageView(this).apply {
                contentDescription = "Back"
                setImageDrawable(WatchIcon("back", Color.LTGRAY))
                setPadding(dp(8), dp(8), dp(8), dp(8))
                isClickable = true
                isFocusable = true
                setOnClickListener { model.back() }
            }
        root.addView(
            backButton,
            FrameLayout.LayoutParams(dp(36), dp(36), Gravity.TOP or Gravity.START).apply {
                topMargin = dp(12)
                leftMargin = dp(29)
            },
        )
        setContentView(root)
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (model.state.value.destination == WatchDestination.Home) finish()
                    else model.back()
                }
            },
        )
        if (savedInstanceState == null) route(intent)
        else {
            // After a configuration change the view model still holds the screen;
            // only a recreated process starts again from Home and needs this.
            val restored = WatchDestination.decode(savedInstanceState.getString(DESTINATION))
            if (
                restored != null &&
                    restored !is WatchDestination.Command &&
                    model.state.value.destination == WatchDestination.Home
            )
                model.open(restored)
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { model.state.collect(::render) }
        }
        if (
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        )
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        route(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(DESTINATION, model.state.value.destination.encode())
    }

    override fun onStart() {
        super.onStart()
        visible = true
        ContextCompat.registerReceiver(
            this,
            receiver,
            IntentFilter("com.noted.wear.REFRESH"),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        handler.post(tick)
        handler.postDelayed(poll, 20000)
        model.load()
        model.refresh()
    }

    override fun onStop() {
        visible = false
        handler.removeCallbacks(tick)
        handler.removeCallbacks(poll)
        unregisterReceiver(receiver)
        super.onStop()
    }

    private fun route(intent: Intent) {
        val extras =
            object : NotificationExtras {
                override fun string(key: String) = intent.getStringExtra(key)

                override fun int(key: String) = intent.getIntExtra(key, 0)

                override fun flag(key: String) = intent.getBooleanExtra(key, false)
            }
        WatchIntentRouter.route(extras)?.let(model::route)
    }

    private fun render(state: WatchUiState) {
        val key = state.destination.encode()
        val position = if (rendered == key) scroll.scrollY else 0
        rendered = key
        content.removeAllViews()
        content.gravity = Gravity.NO_GRAVITY
        content.minimumHeight = 0
        elapsedView = null
        handler.removeCallbacks(returnHome)
        backButton.visibility =
            if (state.destination == WatchDestination.Home) View.GONE else View.VISIBLE
        val snapshot = state.snapshot
        val accent =
            runCatching { Color.parseColor(snapshot?.preferences?.accent) }
                .getOrDefault(Color.rgb(226, 193, 90))
        val views =
            WatchViews(
                this,
                content,
                accent,
                snapshot?.preferences?.textScale ?: 1f,
                scroll.height - scroll.paddingTop - scroll.paddingBottom,
            ) {
                model.state.value.busy
            }
        if (!state.paired) {
            views.text("Noted", 24f)
            views.text(
                "On your phone, open Noted Settings › Devices and choose Pair watch. Install matching phone and watch apps.",
                13f,
                Color.LTGRAY,
            )
            views.button("Check connection") {
                model.load()
                model.refresh()
            }
            views.button("Watch face") { openWatchFace() }
            return
        }
        if (snapshot == null) {
            views.text("Connecting...", 18f)
            views.button("Retry") { model.refresh() }
            views.button("Watch face") { openWatchFace() }
            return
        }
        when (val destination = state.destination) {
            WatchDestination.Home -> elapsedView = views.home(state, model)
            WatchDestination.Upcoming -> views.upcomingList(snapshot, model)
            WatchDestination.Activities -> views.activities(snapshot, model)
            is WatchDestination.OtherActivity ->
                views.activities(snapshot, model, destination.promptId)
            is WatchDestination.PlanDetails ->
                snapshot.plan(destination.planId)?.let { views.plan(it, model) } ?: goHome()
            is WatchDestination.PromptDetails ->
                snapshot.prompt(destination.promptId)?.let { views.prompt(it, model) }
                    ?: views.text("Checking…", 16f)
            is WatchDestination.Delay ->
                snapshot.prompt(destination.promptId)?.let {
                    views.delay(it, destination.activityId, state, model)
                } ?: views.text("Checking…", 16f)
            is WatchDestination.ReminderDetails ->
                snapshot.reminder(destination.messageId)?.let {
                    views.reminder(it, snapshot.snoozeMinutes, model)
                } ?: goHome()
            WatchDestination.Settings -> views.settings(model, ::openWatchFace)
            WatchDestination.Diagnostics ->
                views.diagnostics(state, model) {
                    startActivity(
                        Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName),
                    )
                }
            is WatchDestination.Command -> views.command(destination, state, model)
            is WatchDestination.Outdated -> views.outdated(state.outdated, model)
        }
        if (state.command == CommandState.Done && lastCommand != CommandState.Done) {
            content.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
        }
        if (state.command == CommandState.Done && state.destination is WatchDestination.Command)
            handler.postDelayed(returnHome, 3000)
        lastCommand = state.command
        state.error?.let { error ->
            views.text(error, 12f, DANGER)
            views.button("Retry") { model.refresh() }
        }
        if (state.destination == WatchDestination.Diagnostics && state.test != TestState.Idle)
            scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
        else scroll.post { scroll.scrollTo(0, position) }
    }

    private fun goHome() = handler.post { model.open(WatchDestination.Home) }

    private fun openWatchFace() = startActivity(Intent(this, WatchFaceActivity::class.java))

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val DESTINATION = "destination"
    }
}
