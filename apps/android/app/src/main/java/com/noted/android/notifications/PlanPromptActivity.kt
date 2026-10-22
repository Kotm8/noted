package com.noted.android.notifications

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.core.widget.addTextChangedListener
import com.noted.android.MainActivity
import com.noted.android.connection.ConnectionStore
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject

class PlanPromptActivity : ComponentActivity() {
    private val network = Executors.newSingleThreadExecutor()
    private lateinit var root: LinearLayout
    private var origin = ""
    private var binding = ""
    private var promptId = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(24, 20, 24, 20)
                setBackgroundColor(Color.rgb(31, 31, 31))
            }
        setContentView(ScrollView(this).apply { addView(root) })
        window.setGravity(Gravity.BOTTOM)
        window.setLayout(-1, -2)
        val state = PushState(this).read()
        origin = intent.getStringExtra("origin").orEmpty()
        binding = intent.getStringExtra("binding").orEmpty()
        promptId = intent.getStringExtra("prompt_id").orEmpty()
        if (
            state == null ||
                state.optString("secret").isBlank() ||
                state.optString("origin") != origin ||
                state.optString("binding") != binding ||
                ConnectionStore(this).origin != origin ||
                runCatching { UUID.fromString(promptId) }.isFailure
        ) {
            fail("Sign in to your selected server and enable notifications again.")
            return
        }
        root.addView(ProgressBar(this))
        network.execute {
            val result = runCatching {
                val prompts =
                    PushHttp.request(
                            origin,
                            "/api/v1/notifications/android/plan-prompts",
                            "GET",
                            secret = state.getString("secret"),
                        )
                        .getJSONArray("prompts")
                val prompt =
                    (0 until prompts.length())
                        .map { prompts.getJSONObject(it) }
                        .find { it.getString("id") == promptId }
                        ?: error(
                            "This task prompt changed on another device. Open Noted to see the current plan.",
                        )
                val activities =
                    PushHttp.request(
                            origin,
                            "/api/v1/notifications/android/activities",
                            "GET",
                            secret = state.getString("secret"),
                        )
                        .getJSONArray("activities")
                prompt to (0 until activities.length()).map { activities.getJSONObject(it) }
            }
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                result
                    .onSuccess { (prompt, activities) -> showForm(prompt, activities) }
                    .onFailure { fail(it.message ?: "Could not load this task prompt.") }
            }
        }
    }

    private fun showForm(prompt: JSONObject, activities: List<JSONObject>) {
        val ended = prompt.optString("phase") == "end"
        root.removeAllViews()
        root.addView(
            TextView(this).apply {
                text = prompt.getString("title")
                textSize = 19f
                setTextColor(Color.WHITE)
            },
        )
        root.addView(
            TextView(this).apply {
                text =
                    if (ended)
                        "Snoozing keeps your current activity running. Your plan stays in place."
                    else "Delay the prompt; the planned block stays in place."
                setPadding(0, 8, 0, 16)
                setTextColor(Color.LTGRAY)
            },
        )
        val modes =
            spinner(
                if (ended) null else "What are you doing?",
                listOf("Continue current activity", "Track another activity"),
            )
        if (ended) {
            modes.isEnabled = false
            modes.visibility = View.GONE
        }
        val alternatives = activities.filter {
            it.getString("id") != prompt.getString("activity_id")
        }
        val activityLabel = label("Activity")
        val activity =
            Spinner(this).apply {
                adapter =
                    ArrayAdapter(
                        this@PlanPromptActivity,
                        android.R.layout.simple_spinner_dropdown_item,
                        alternatives.map { it.getString("name") },
                    )
            }
        root.addView(activity)
        activityLabel.visibility = View.GONE
        activity.visibility = View.GONE
        val delays =
            spinner(
                "Remind me again in",
                listOf("5 minutes", "10 minutes", "15 minutes", "30 minutes", "1 hour"),
            )
        val reasons =
            spinner(
                "Reason",
                listOf(
                    "Choose a reason",
                    "Finishing up current task",
                    "Taking a break",
                    "Something came up",
                    "Write a reason",
                ),
            )
        val custom =
            EditText(this).apply {
                hint = "Your reason"
                maxLines = 3
                filters = arrayOf(android.text.InputFilter.LengthFilter(500))
                visibility = View.GONE
            }
        root.addView(custom)
        val error =
            TextView(this).apply {
                setTextColor(Color.rgb(223, 157, 150))
                textSize = 13f
            }
        root.addView(error)
        val save =
            Button(this).apply {
                text = "Delay prompt"
                isAllCaps = false
                isEnabled = false
            }
        fun update() {
            val other = modes.selectedItemPosition == 1
            activityLabel.visibility = if (other) View.VISIBLE else View.GONE
            activity.visibility = if (other) View.VISIBLE else View.GONE
            custom.visibility = if (reasons.selectedItemPosition == 4) View.VISIBLE else View.GONE
            save.text =
                if (other) "Switch activity & delay"
                else if (ended) "Snooze prompt" else "Delay prompt"
            save.isEnabled =
                reasons.selectedItemPosition > 0 &&
                    (reasons.selectedItemPosition != 4 || custom.text.toString().isNotBlank()) &&
                    (!other || alternatives.isNotEmpty())
        }
        val listener =
            object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(
                    parent: AdapterView<*>?,
                    view: View?,
                    position: Int,
                    id: Long,
                ) = update()

                override fun onNothingSelected(parent: AdapterView<*>?) = Unit
            }
        modes.onItemSelectedListener = listener
        reasons.onItemSelectedListener = listener
        reasons.setSelection(1)
        update()
        custom.addTextChangedListener { update() }
        save.setOnClickListener {
            val state = PushState(this).read()
            if (state?.optString("binding") != binding) {
                fail("This phone connection changed. Open Noted and try again.")
                return@setOnClickListener
            }
            val other = modes.selectedItemPosition == 1
            val body =
                JSONObject()
                    .put("action", if (other) "other" else "delay")
                    .put("revision", prompt.getInt("revision"))
                    .put("request_id", UUID.randomUUID().toString())
                    .put("requested_at", java.time.Instant.now().toString())
                    .put("minutes", listOf(5, 10, 15, 30, 60)[delays.selectedItemPosition])
                    .put(
                        "reason",
                        if (reasons.selectedItemPosition == 4) custom.text.toString().trim()
                        else reasons.selectedItem.toString(),
                    )
            if (other)
                body.put("activity_id", alternatives[activity.selectedItemPosition].getString("id"))
            save.isEnabled = false
            network.execute {
                val result = runCatching {
                    PushHttp.request(
                        origin,
                        "/api/v1/notifications/android/plan-prompts/$promptId/actions",
                        body = body,
                        secret = state!!.getString("secret"),
                    )
                }
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    result
                        .onSuccess {
                            PushNotifications.cancelRevision(
                                this,
                                "$origin:$promptId",
                                prompt.getInt("revision"),
                            )
                            finish()
                        }
                        .onFailure {
                            error.text = it.message ?: "Could not delay the prompt. Try again."
                            update()
                        }
                }
            }
        }
        root.addView(save)
        root.addView(
            Button(this).apply {
                text = "Cancel"
                isAllCaps = false
                setOnClickListener { finish() }
            },
        )
    }

    private fun label(text: String): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(Color.LTGRAY)
            setPadding(0, 12, 0, 4)
            root.addView(this)
        }

    private fun spinner(title: String?, options: List<String>): Spinner {
        if (title != null) label(title)
        return Spinner(this).apply {
            adapter =
                ArrayAdapter(
                    this@PlanPromptActivity,
                    android.R.layout.simple_spinner_dropdown_item,
                    options,
                )
            root.addView(this)
        }
    }

    private fun fail(message: String) {
        root.removeAllViews()
        root.addView(
            TextView(this).apply {
                text = message
                setTextColor(Color.LTGRAY)
            },
        )
        root.addView(
            Button(this).apply {
                text = "Open Noted"
                isAllCaps = false
                setOnClickListener {
                    startActivity(Intent(this@PlanPromptActivity, MainActivity::class.java))
                    finish()
                }
            },
        )
    }

    override fun onDestroy() {
        network.shutdownNow()
        super.onDestroy()
    }
}
