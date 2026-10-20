package com.noted.wear.ui

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.noted.wear.data.WatchData
import com.noted.wear.data.WatchHttpException
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import com.noted.wear.notifications.WatchPush
import com.noted.wear.watchface.WatchFaceActivity
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject

class WatchActivity : ComponentActivity() {
    private val network = Executors.newSingleThreadExecutor()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var root: FrameLayout
    private lateinit var content: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var clock: TextView
    private var elapsedView: TextView? = null
    private var snapshot: JSONObject? = null
    private var screen = "home"
    private var busy = false
    private var visible = false
    private var prompt: JSONObject? = null
    private var selectedReminder: JSONObject? = null
    private var selectedPlan: JSONObject? = null
    private var delayMinutes = 10
    private var delayReason = ""
    private var alternative: String? = null
    private var choosingAlternative = false
    private var accent = Color.rgb(226, 193, 90)
    private var scale = 1f
    private var elapsedBase = 0L
    private var elapsedAt = 0L
    private var trackerRunning = false
    private val permission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            WatchPush.scheduleRegistration(this)
        }
    private val receiver =
        object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                refresh()
            }
        }
    private val tick =
        object : Runnable {
            override fun run() {
                if (!visible) return
                clock.text = DateTimeFormatter.ofPattern("HH:mm").format(java.time.LocalTime.now())
                val seconds =
                    elapsedBase +
                        if (trackerRunning) (SystemClock.elapsedRealtime() - elapsedAt) / 1000
                        else 0
                elapsedView?.text = WatchData.duration(seconds)
                handler.postDelayed(this, 1000)
            }
        }
    private val poll =
        object : Runnable {
            override fun run() {
                if (!visible) return
                if (screen == "home" && !busy) refresh()
                handler.postDelayed(this, 20000)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(8, 10, 9)) }
        scroll =
            ScrollView(this).apply {
                isVerticalScrollBarEnabled = false
                clipToPadding = false
                setPadding(dp(26), dp(36), dp(26), dp(64))
                isFocusable = true
                setOnGenericMotionListener { _, event ->
                    if (event.action == MotionEvent.ACTION_SCROLL) {
                        smoothScrollBy(
                            0,
                            (-event.getAxisValue(MotionEvent.AXIS_SCROLL) * dp(28)).toInt(),
                        )
                        true
                    } else false
                }
            }
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(content)
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        clock =
            TextView(this).apply {
                textSize = 11f
                gravity = Gravity.CENTER
                setTextColor(Color.LTGRAY)
                setBackgroundColor(Color.rgb(8, 10, 9))
            }
        root.addView(
            clock,
            FrameLayout.LayoutParams(dp(70), dp(25), Gravity.TOP or Gravity.CENTER_HORIZONTAL)
                .apply { topMargin = dp(5) },
        )
        setContentView(root)
        snapshot = WatchStore(this).snapshot()
        restoreSnapshot()
        render()
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (screen != "home") {
                        screen = "home"
                        render()
                    } else finish()
                }
            },
        )
        if (
            Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        )
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        refresh()
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
        refresh()
    }

    override fun onStop() {
        visible = false
        handler.removeCallbacks(tick)
        handler.removeCallbacks(poll)
        unregisterReceiver(receiver)
        super.onStop()
    }

    override fun onDestroy() {
        network.shutdownNow()
        super.onDestroy()
    }

    private fun refresh() {
        if (busy || WatchStore(this).credentials() == null) {
            if (!busy) render()
            return
        }
        execute { WatchRepository(this).refresh() }
    }

    private fun execute(action: () -> JSONObject) {
        if (busy) return
        busy = true
        content.isEnabled = false
        network.execute {
            val result = runCatching(action)
            runOnUiThread {
                busy = false
                if (isDestroyed || isFinishing) return@runOnUiThread
                content.isEnabled = true
                result
                    .onSuccess {
                        snapshot = if (WatchStore(this).credentials() == null) null else it
                        restoreSnapshot()
                        render()
                    }
                    .onFailure { error ->
                        if (error is WatchHttpException && error.status == 409) {
                            screen = "home"
                            android.widget.Toast.makeText(
                                    this,
                                    "Changed on another device. Refreshing your watch.",
                                    android.widget.Toast.LENGTH_LONG,
                                )
                                .show()
                            refresh()
                            return@onFailure
                        }
                        snapshot = WatchStore(this).snapshot()
                        render()
                        text(
                            error.message ?: "Could not reach your server. Try again.",
                            12f,
                            Color.rgb(223, 157, 150),
                        )
                        button("Retry") { refresh() }
                    }
            }
        }
    }

    private fun restoreSnapshot() {
        val value = snapshot ?: return
        val settings = value.optJSONObject("settings") ?: JSONObject()
        accent =
            runCatching { Color.parseColor(settings.optString("accent", "#e2c15a")) }
                .getOrDefault(accent)
        scale = settings.optDouble("text_scale", 1.0).toFloat().coerceIn(.85f, 1.3f)
        elapsedBase = WatchData.elapsed(value)
        elapsedAt = SystemClock.elapsedRealtime()
        trackerRunning = value.getJSONObject("tracker").optJSONObject("active") != null
        intent.getStringExtra("prompt_id")?.let { id ->
            prompt =
                WatchData.items(value.optJSONArray("prompts")).find { it.optString("id") == id }
            if (prompt != null)
                screen = if (intent.getBooleanExtra("delay", false)) "delay" else "plan"
            if (prompt != null) {
                intent.removeExtra("prompt_id")
                intent.removeExtra("delay")
            }
        }
        intent.getStringExtra("message_id")?.let { id ->
            selectedReminder =
                WatchData.items(value.getJSONObject("board").optJSONArray("reminders")).find {
                    it.optString("message_id") == id
                }
            if (selectedReminder != null) screen = "reminder"
            if (selectedReminder != null) intent.removeExtra("message_id")
        }
    }

    private fun render() {
        content.removeAllViews()
        elapsedView = null
        if (WatchStore(this).credentials() == null) {
            text("Noted", 24f)
            text(
                "On your phone, open Noted Settings > Watch and choose Pair watch. Install matching phone and watch APKs.",
                13f,
                Color.LTGRAY,
            )
            button("Check connection") {
                snapshot = WatchStore(this).snapshot()
                if (WatchStore(this).credentials() != null) refresh()
            }
            watchFaceButton()
            return
        }
        if (snapshot == null) {
            text("Connecting...", 18f)
            button("Retry") { refresh() }
            watchFaceButton()
            return
        }
        if (screen != "home")
            button("Back", "back", false) {
                screen = "home"
                render()
            }
        when (screen) {
            "picker" -> showActivities()
            "plan" -> showPlan()
            "delay" -> showDelay()
            "reminder" -> showReminder()
            "settings" -> showSettings()
            "upcoming" -> showUpcoming()
            else -> showHome()
        }
        scroll.scrollTo(0, 0)
    }

    private fun showHome() {
        val value = snapshot ?: return
        val current = WatchData.current(value)
        label(
            if (trackerRunning) "CURRENT ACTIVITY"
            else if (current != null) "PAUSED" else "NOT TRACKING"
        )
        button(
            current?.optString("name") ?: "Choose an activity",
            current?.optString("icon") ?: "next",
            false,
        ) {
            choosingAlternative = false
            screen = "picker"
            render()
        }
        elapsedView =
            text(WatchData.duration(elapsedBase), 15f, accent).apply {
                typeface = Typeface.MONOSPACE
            }
        divider()
        label("UP NEXT")
        val upcoming = UpcomingItem.from(value)
        upcoming.take(2).forEach { item -> upcomingButton(item) }
        if (upcoming.isEmpty()) text("Nothing coming up.", 13f, Color.GRAY)
        button("Switch activity", primary = true) {
            choosingAlternative = false
            screen = "picker"
            render()
        }
        button("Watch settings") {
            screen = "settings"
            render()
        }
        if (upcoming.size > 2)
            button("More upcoming") {
                screen = "upcoming"
                render()
            }
    }

    private fun showUpcoming() {
        text("Upcoming", 21f)
        snapshot?.let { UpcomingItem.from(it).forEach { item -> upcomingButton(item) } }
    }

    private fun upcomingButton(item: UpcomingItem) {
        button(item.title, if (item.kind == "plan") "next" else "flag", false, item.subtitle) {
            alternative = null
            when (item.kind) {
                "reminder" -> {
                    selectedReminder = item.value
                    screen = "reminder"
                }
                "prompt" -> {
                    prompt = item.value
                    selectedPlan = null
                    screen = "plan"
                }
                else -> {
                    prompt = null
                    selectedPlan = item.value
                    screen = "plan"
                }
            }
            render()
        }
    }

    private fun showActivities() {
        val value = snapshot ?: return
        text(if (choosingAlternative) "Doing something else?" else "Switch activity", 20f)
        val favorites =
            value.optJSONObject("settings")?.optJSONArray("favorites")?.let { array ->
                (0 until array.length()).map { array.getString(it) }
            } ?: emptyList()
        WatchData.items(value.optJSONArray("activities"))
            .sortedBy { if (it.optString("id") in favorites) 0 else 1 }
            .forEach { activity ->
                button(activity.getString("name"), activity.optString("icon"), false) {
                    if (choosingAlternative) {
                        alternative = activity.getString("id")
                        delayReason = ""
                        screen = "delay"
                        render()
                    } else tracker("start", activity.getString("id"))
                }
            }
        if (!choosingAlternative) {
            button(
                if (trackerRunning) "Pause" else "Resume",
                if (trackerRunning) "pause" else "play",
            ) {
                tracker(if (trackerRunning) "pause" else "resume")
            }
            button("Stop") { tracker("stop") }
        }
    }

    private fun tracker(action: String, activity: String? = null) {
        val value = snapshot ?: return
        val data =
            JSONObject()
                .put("action", action)
                .put("revision", value.getJSONObject("tracker").getInt("revision"))
                .put("request_id", UUID.randomUUID().toString())
        activity?.let { data.put("activity_id", it) }
        execute {
            val repository = WatchRepository(this)
            repository.request("tracker", data)
            screen = "home"
            repository.refresh()
        }
    }

    private fun showPlan() {
        val item = prompt ?: selectedPlan ?: return
        label("PLANNED ACTIVITY")
        text(item.optString("title"), 23f)
        text(
            WatchData.time(item.optString("planned_start", item.optString("start_at"))),
            16f,
            accent,
        )
        button("Start activity", "play", true) {
            if (prompt == null) tracker("start", item.getString("activity_id"))
            else promptAction("start")
        }
        if (prompt != null) {
            button("Delay prompt") {
                alternative = null
                delayReason = ""
                screen = "delay"
                render()
            }
            button("Doing something else") {
                choosingAlternative = true
                screen = "picker"
                render()
            }
        } else text("Delay becomes available when this plan's prompt arrives.", 12f, Color.GRAY)
    }

    private fun showDelay() {
        text("Remind me later", 21f)
        text("The planned block stays in place.", 12f, Color.LTGRAY)
        label("DELAY FROM NOW")
        listOf(5, 10, 15, 30, 60).forEach { minutes ->
            button(
                if (minutes == 60) "1 hour" else "$minutes minutes",
                if (delayMinutes == minutes) "check" else "",
            ) {
                delayMinutes = minutes
                val position = scroll.scrollY
                showDelayAgain(position)
            }
        }
        label("REASON / REQUIRED")
        listOf("Finishing current activity", "Taking a break", "Something came up").forEach { reason
            ->
            button(reason, if (delayReason == reason) "check" else "") {
                delayReason = reason
                showDelayAgain(scroll.scrollY)
            }
        }
        val custom =
            EditText(this).apply {
                hint = "Or write a reason"
                textSize = 14f
                setTextColor(Color.WHITE)
                setHintTextColor(Color.GRAY)
                setSingleLine()
                filters = arrayOf(android.text.InputFilter.LengthFilter(500))
            }
        content.addView(custom)
        button(if (alternative == null) "Delay prompt" else "Switch and delay", primary = true) {
            val reason = custom.text.toString().trim().ifBlank { delayReason }
            if (reason.isBlank()) {
                custom.error = "Choose or write a reason"
                return@button
            }
            delayReason = reason
            promptAction(if (alternative == null) "delay" else "other")
        }
    }

    private fun showDelayAgain(position: Int) {
        content.removeAllViews()
        button("Back", "back") {
            screen = "plan"
            render()
        }
        showDelay()
        scroll.post { scroll.scrollTo(0, position) }
    }

    private fun promptAction(action: String) {
        val item = prompt ?: return
        val data =
            JSONObject()
                .put("action", action)
                .put("revision", item.getInt("revision"))
                .put("request_id", UUID.randomUUID().toString())
                .put("requested_at", Instant.now().toString())
        if (action != "start") data.put("minutes", delayMinutes).put("reason", delayReason)
        alternative?.let { data.put("activity_id", it) }
        execute {
            val repository = WatchRepository(this)
            repository.request("prompts/${item.getString("id")}/actions", data)
            screen = "home"
            repository.refresh()
        }
    }

    private fun showReminder() {
        val item = selectedReminder ?: return
        label("REMINDER / ${WatchData.time(item.getString("due_at"))}")
        text(item.optString("content"), 18f)
        text(
            "${item.optString("workspace_name")} / ${item.optString("channel_name")}",
            12f,
            Color.GRAY,
        )
        button("Done", "check", true) { reminderAction("done") }
        val minutes = snapshot?.optJSONObject("notifications")?.optInt("snooze_minutes", 10) ?: 10
        button("Snooze $minutes minutes") { reminderAction("snooze", minutes) }
    }

    private fun reminderAction(action: String, minutes: Int? = null) {
        val item = selectedReminder ?: return
        val data = JSONObject().put("action", action).put("revision", item.getInt("revision"))
        minutes?.let { data.put("minutes", it) }
        execute {
            val repository = WatchRepository(this)
            repository.request("reminders/${item.getString("message_id")}/actions", data)
            screen = "home"
            repository.refresh()
        }
    }

    private fun showSettings() {
        text("Watch settings", 21f)
        text(
            "Choose layouts, colors, favorites, and text size from Noted Settings > Watch on your phone. Edit steps, sleep, and battery slots from the watch face's Customize screen.",
            13f,
            Color.LTGRAY,
        )
        text(
            "Last sync: ${WatchData.time(Instant.ofEpochMilli(WatchStore(this).syncedAt()).toString())}",
            12f,
            Color.GRAY,
        )
        watchFaceButton()
        button("Sync now") { refresh() }
        button("Disconnect watch") {
            execute {
                val repository = WatchRepository(this)
                repository.request("device", method = "DELETE")
                WatchStore(this).clear()
                snapshot = null
                JSONObject()
            }
        }
    }

    private fun watchFaceButton() {
        button("Watch face") { startActivity(Intent(this, WatchFaceActivity::class.java)) }
    }

    private fun label(value: String) = text(value, 10f, Color.rgb(145, 154, 139))

    private fun text(value: String, size: Float, color: Int = Color.WHITE): TextView {
        return TextView(this).apply {
            text = value
            textSize = size * scale
            setTextColor(color)
            setPadding(0, dp(4), 0, dp(5))
            content.addView(this, LinearLayout.LayoutParams(-1, -2))
        }
    }

    private fun divider() {
        content.addView(
            View(this).apply { setBackgroundColor(Color.rgb(42, 49, 39)) },
            LinearLayout.LayoutParams(-1, dp(1)).apply {
                topMargin = dp(7)
                bottomMargin = dp(7)
            },
        )
    }

    private fun button(
        title: String,
        icon: String = "",
        primary: Boolean = false,
        subtitle: String = "",
        action: () -> Unit,
    ) {
        val row =
            LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                minimumHeight = dp(42)
                setPadding(dp(9), dp(6), dp(9), dp(6))
                background =
                    GradientDrawable().apply {
                        cornerRadius = dp(if (primary) 24 else 7).toFloat()
                        setColor(if (primary) accent else Color.TRANSPARENT)
                    }
                isClickable = true
                isFocusable = true
                contentDescription =
                    listOf(title, subtitle).filter { it.isNotBlank() }.joinToString(", ")
                setOnClickListener {
                    if (!busy) {
                        performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK)
                        action()
                    }
                }
            }
        if (icon.isNotEmpty())
            row.addView(
                android.widget.ImageView(this).apply {
                    setImageDrawable(WatchIcon(icon, if (primary) Color.BLACK else accent))
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                },
                LinearLayout.LayoutParams(dp(19), dp(19)).apply { marginEnd = dp(8) },
            )
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(
            TextView(this).apply {
                text = title
                textSize = (if (primary) 14f else 14.5f) * scale
                setTextColor(if (primary) Color.BLACK else Color.WHITE)
                maxLines = 3
            }
        )
        if (subtitle.isNotEmpty())
            column.addView(
                TextView(this).apply {
                    text = subtitle
                    textSize = 10.5f * scale
                    setTextColor(Color.rgb(156, 168, 149))
                    maxLines = 2
                }
            )
        row.addView(column, LinearLayout.LayoutParams(-1, -2))
        content.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3) })
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
