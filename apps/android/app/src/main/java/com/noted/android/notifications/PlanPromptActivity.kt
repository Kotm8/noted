package com.noted.android.notifications

import android.content.Intent
import android.os.Bundle
import android.view.Gravity
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.noted.android.MainActivity
import com.noted.android.NotedApplication
import com.noted.android.connection.ConnectionStore
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

class PlanPromptActivity : ComponentActivity() {
    private var origin = ""
    private var binding = ""
    private var promptId = ""
    private var prompt by mutableStateOf<JSONObject?>(null)
    private var activities by mutableStateOf(emptyList<JSONObject>())
    private var failure by mutableStateOf<String?>(null)
    private var saving by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AccountTheme((application as NotedApplication).repository) {
                Surface {
                    Column(Modifier.fillMaxWidth().heightIn(max = 650.dp).navigationBarsPadding()
                        .imePadding().verticalScroll(rememberScrollState()).padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        val item = prompt
                        if (item == null) {
                            Text("Activity prompt", style = MaterialTheme.typography.titleMedium)
                            if (failure == null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                            else {
                                QuietNotice(failure!!, true)
                                NotedButton({ startActivity(Intent(this@PlanPromptActivity, MainActivity::class.java)); finish() }) { Text("Open Noted") }
                            }
                        } else PromptForm(item)
                    }
                }
            }
        }
        window.setGravity(Gravity.BOTTOM)
        window.setLayout(-1, -2)
        origin = intent.getStringExtra("origin").orEmpty()
        binding = intent.getStringExtra("binding").orEmpty()
        promptId = intent.getStringExtra("prompt_id").orEmpty()
        val state = PushState(this).read()
        if (state == null || state.text("secret").isBlank() || state.text("origin") != origin ||
            state.text("binding") != binding || ConnectionStore(this).origin != origin ||
            runCatching { UUID.fromString(promptId) }.isFailure) {
            failure = "Sign in to your selected server and enable notifications again."
            return
        }
        lifecycleScope.launch {
            try {
                val loaded = withContext(Dispatchers.IO) {
                    val items = PushHttp.request(origin, "/api/v1/notifications/android/plan-prompts", "GET", secret = state.text("secret")).rows("prompts")
                    val selected = items.firstOrNull { it.text("id") == promptId }
                        ?: error("This prompt changed on another device. Open Noted to see the current plan.")
                    selected to PushHttp.request(origin, "/api/v1/notifications/android/activities", "GET", secret = state.text("secret")).rows("activities")
                }
                prompt = loaded.first
                activities = loaded.second
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (error: Exception) { failure = error.message ?: "Could not load this task prompt." }
        }
    }

    @Composable
    private fun PromptForm(item: JSONObject) {
        val ended = item.text("phase") == "end"
        var other by remember { mutableStateOf("") }
        var minutes by remember { mutableIntStateOf(5) }
        var reason by remember { mutableStateOf("Finishing up current task") }
        val alternatives = activities.filter { it.text("id") != item.text("activity_id") }
        Text(item.text("title"), style = MaterialTheme.typography.titleMedium)
        QuietNotice(if (ended) "Snoozing keeps your current activity running. Your plan stays in place."
            else "Delay the prompt; the planned block stays in place.")
        if (!ended) Choice("Activity", other, listOf("" to "Continue current activity") + alternatives.map { it.text("id") to it.text("name") }) { other = it }
        Choice("Remind me in", minutes, listOf(5, 10, 15, 30, 60).map { it to "$it minutes" }) { minutes = it }
        Choice("Reason", reason, listOf("Finishing up current task", "Taking a break", "Something came up").map { it to it }) { reason = it }
        Field("Reason", reason, { reason = it.take(500) }, singleLine = false)
        failure?.let { QuietNotice(it, true) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.End)) {
            NotedOutlinedButton({ finish() }, enabled = !saving) { Text("Cancel") }
            NotedButton({ save(item, other, minutes, reason) }, enabled = !saving && reason.isNotBlank()) {
                Text(if (other.isNotBlank()) "Switch and snooze" else "Snooze")
            }
        }
    }

    private fun save(item: JSONObject, activity: String, minutes: Int, reason: String) {
        val state = PushState(this).read()
        if (state?.text("binding") != binding || state.text("origin") != origin) {
            failure = "This phone connection changed. Open Noted and try again."
            return
        }
        val body = json("action" to if (activity.isBlank()) "delay" else "other", "revision" to item.optInt("revision"),
            "request_id" to UUID.randomUUID().toString(), "requested_at" to Instant.now().toString(),
            "minutes" to minutes, "reason" to reason.trim())
        if (activity.isNotBlank()) body.put("activity_id", activity)
        saving = true
        failure = null
        lifecycleScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    PushHttp.request(origin, "/api/v1/notifications/android/plan-prompts/$promptId/actions", body = body, secret = state.text("secret"))
                }
                PushNotifications.cancelRevision(this@PlanPromptActivity, "$origin:$promptId", item.optInt("revision"))
                (application as NotedApplication).repository.changed("prompts")
                finish()
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (error: Exception) { failure = error.message ?: "Could not delay the prompt. Try again." }
            finally { saving = false }
        }
    }
}
