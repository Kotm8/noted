package com.noted.wear.ui

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.noted.wear.data.Outdated
import com.noted.wear.data.Prompt
import com.noted.wear.data.PromptOutcome
import com.noted.wear.data.Snapshot
import com.noted.wear.data.WatchHttpException
import com.noted.wear.data.WatchRepository
import com.noted.wear.data.WatchStore
import com.noted.wear.navigation.WatchDestination
import com.noted.wear.navigation.WatchIntentRouter
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

const val FINISHING_REASON = "Finishing up current task"

data class DelayDraft(val minutes: Int = 10, val reason: String = FINISHING_REASON)

sealed interface CommandState {
    data object Running : CommandState

    /** Still waiting after a few seconds; the request id keeps a retry from applying twice. */
    data object Slow : CommandState

    data object Done : CommandState

    data class Failed(val message: String) : CommandState
}

sealed interface TestState {
    data object Idle : TestState

    data object Sending : TestState

    data class Waiting(val testId: String) : TestState

    data class Arrived(val at: Long) : TestState

    data class Failed(val message: String) : TestState
}

data class WatchUiState(
    val paired: Boolean = false,
    val snapshot: Snapshot? = null,
    val destination: WatchDestination = WatchDestination.Home,
    val busy: Boolean = false,
    val error: String? = null,
    val notice: String? = null,
    val command: CommandState? = null,
    /** The prompt as its notification showed it; answered prompts leave the snapshot. */
    val commandPrompt: Prompt? = null,
    val outdated: Outdated? = null,
    val delay: DelayDraft = DelayDraft(),
    val reachable: Boolean? = null,
    val test: TestState = TestState.Idle,
)

class WatchViewModel(application: Application) : AndroidViewModel(application) {
    private val context = application
    private val store = WatchStore(application)
    private val mutable = MutableStateFlow(WatchUiState())
    val state: StateFlow<WatchUiState> = mutable.asStateFlow()
    private var testWatch: Job? = null

    init {
        load()
    }

    /** Re-reads what's stored, for example after pairing or a background sync. */
    fun load() {
        val paired = store.credentials() != null
        mutable.update {
            it.copy(
                paired = paired,
                snapshot = if (paired) store.snapshot()?.let(::parse) else null,
            )
        }
    }

    fun open(destination: WatchDestination) {
        mutable.update {
            it.copy(
                destination = destination,
                error = null,
                notice = null,
                delay =
                    if (
                        destination is WatchDestination.Delay &&
                            it.destination !is WatchDestination.Delay
                    )
                        DelayDraft()
                    else it.delay,
            )
        }
        when (destination) {
            is WatchDestination.PromptDetails -> ensurePrompt(destination.promptId)
            is WatchDestination.Delay -> ensurePrompt(destination.promptId)
            is WatchDestination.Diagnostics -> checkServer()
            else -> Unit
        }
    }

    fun back() =
        open(
            when (val current = state.value.destination) {
                is WatchDestination.Diagnostics -> WatchDestination.Settings
                is WatchDestination.Delay ->
                    if (current.activityId != null) WatchDestination.OtherActivity(current.promptId)
                    else WatchDestination.PromptDetails(current.promptId)
                else -> WatchDestination.Home
            },
        )

    /** Applies a destination from a launch or notification intent, each command only once. */
    fun route(destination: WatchDestination) {
        if (destination is WatchDestination.Command) {
            val key = destination.encode()
            if (store.handled(key)) return
            store.markHandled(key)
            NotificationManagerCompat.from(context).cancel(destination.promptId, 0)
            runCommand(destination)
        } else open(destination)
    }

    fun runCommand(command: WatchDestination.Command) {
        mutable.update {
            it.copy(
                destination = command,
                command = CommandState.Running,
                commandPrompt = it.snapshot?.prompt(command.promptId) ?: it.commandPrompt,
                error = null,
            )
        }
        viewModelScope.launch {
            val slow = launch {
                delay(2500)
                mutable.update {
                    if (it.command == CommandState.Running) it.copy(command = CommandState.Slow)
                    else it
                }
            }
            val result =
                withContext(Dispatchers.IO) {
                    runCatching {
                        val repository = WatchRepository(context)
                        repository.request(
                            "prompts/${command.promptId}/actions",
                            JSONObject()
                                .put("action", command.action)
                                .put("revision", command.revision)
                                .put("request_id", WatchIntentRouter.requestId(command))
                                .put("requested_at", Instant.now().toString()),
                        )
                        repository.refresh()
                    }
                }
            slow.cancel()
            result
                .onSuccess { json ->
                    mutable.update {
                        it.copy(
                            snapshot = parse(json),
                            command = CommandState.Done,
                            reachable = true,
                        )
                    }
                }
                .onFailure { error ->
                    if (error is WatchHttpException && error.status in listOf(404, 409))
                        showOutdated(command.promptId)
                    else
                        mutable.update {
                            it.copy(
                                command = CommandState.Failed(message(error)),
                                reachable = false,
                            )
                        }
                }
        }
    }

    fun refresh() {
        if (!state.value.paired || state.value.busy) return
        perform(navigateHome = false) { WatchRepository(context).refresh() }
    }

    fun tracker(action: String, activityId: String? = null) {
        val snapshot = state.value.snapshot ?: return
        val body =
            JSONObject()
                .put("action", action)
                .put("revision", snapshot.tracker.revision)
                .put("request_id", UUID.randomUUID().toString())
        activityId?.let { body.put("activity_id", it) }
        perform {
            val repository = WatchRepository(context)
            repository.request("tracker", body)
            repository.refresh()
        }
    }

    fun setDelay(draft: DelayDraft) = mutable.update { it.copy(delay = draft) }

    fun promptAction(promptId: String, action: String, activityId: String? = null) {
        val prompt = state.value.snapshot?.prompt(promptId) ?: return
        val draft = state.value.delay
        val body =
            JSONObject()
                .put("action", action)
                .put("revision", prompt.revision)
                .put("request_id", UUID.randomUUID().toString())
                .put("requested_at", Instant.now().toString())
        if (action in listOf("delay", "other"))
            body.put("minutes", draft.minutes).put("reason", draft.reason)
        activityId?.let { body.put("activity_id", it) }
        perform {
            val repository = WatchRepository(context)
            repository.request("prompts/$promptId/actions", body)
            repository.refresh()
        }
    }

    fun reminderAction(messageId: String, action: String, minutes: Int? = null) {
        val reminder = state.value.snapshot?.reminder(messageId) ?: return
        val body = JSONObject().put("action", action).put("revision", reminder.revision)
        minutes?.let { body.put("minutes", it) }
        perform {
            val repository = WatchRepository(context)
            repository.request("reminders/$messageId/actions", body)
            repository.refresh()
        }
    }

    fun disconnect() {
        perform {
            WatchRepository(context).request("device", method = "DELETE")
            store.clear()
            null
        }
    }

    fun notificationsAllowed(): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED

    fun registeredAt(): Long = store.registeredAt()

    fun serverName(): String =
        store.credentials()?.optString("origin")?.removePrefix("https://") ?: "Not paired"

    fun syncedAt(): Long = store.syncedAt()

    /**
     * Asks the server to push to this watch directly. The messaging service
     * records the arrival, which is how the watch knows delivery works.
     */
    fun sendTest() {
        testWatch?.cancel()
        mutable.update { it.copy(test = TestState.Sending) }
        testWatch =
            viewModelScope.launch {
                val sent =
                    withContext(Dispatchers.IO) {
                        runCatching { WatchRepository(context).request("push/test", JSONObject()) }
                    }
                val response =
                    sent.getOrElse { error ->
                        mutable.update {
                            it.copy(test = TestState.Failed(message(error)), reachable = false)
                        }
                        return@launch
                    }
                if (response.optString("outcome") != "accepted") {
                    mutable.update {
                        it.copy(
                            test =
                                TestState.Failed(
                                    "The server couldn't send it. Pair the watch again if this keeps happening.",
                                ),
                        )
                    }
                    return@launch
                }
                val id = response.getString("test_id")
                mutable.update { it.copy(test = TestState.Waiting(id), reachable = true) }
                repeat(60) {
                    store.testArrival(id).takeIf { it > 0 }?.let { at ->
                        mutable.update { it.copy(test = TestState.Arrived(at)) }
                        return@launch
                    }
                    delay(500)
                }
                mutable.update {
                    it.copy(
                        test = TestState.Failed("Sent, but it didn't arrive within 30 seconds."),
                    )
                }
            }
    }

    private fun checkServer() {
        viewModelScope.launch {
            val ok =
                withContext(Dispatchers.IO) { runCatching { WatchRepository(context).refresh() } }
            mutable.update {
                it.copy(
                    reachable = ok.isSuccess,
                    snapshot = ok.getOrNull()?.let(::parse) ?: it.snapshot,
                )
            }
        }
    }

    /** A notification can outlive its prompt; check before showing a screen for it. */
    private fun ensurePrompt(promptId: String) {
        if (state.value.snapshot?.prompt(promptId) != null) return
        viewModelScope.launch {
            val fresh =
                withContext(Dispatchers.IO) { runCatching { WatchRepository(context).refresh() } }
            fresh.getOrNull()?.let { json -> mutable.update { it.copy(snapshot = parse(json)) } }
            if (state.value.snapshot?.prompt(promptId) == null) showOutdated(promptId)
        }
    }

    private fun showOutdated(promptId: String) {
        viewModelScope.launch {
            val result =
                withContext(Dispatchers.IO) {
                    runCatching {
                        val repository = WatchRepository(context)
                        val prompt = Snapshot.prompt(repository.request("prompts/$promptId"))
                        val snapshot = Snapshot.parse(repository.refresh())
                        snapshot to PromptOutcome.classify(prompt, snapshot.plans)
                    }
                }
            result
                .onSuccess { (snapshot, outdated) ->
                    mutable.update {
                        if (outdated == null)
                            it.copy(
                                snapshot = snapshot,
                                destination = WatchDestination.PromptDetails(promptId),
                                command = null,
                            )
                        else
                            it.copy(
                                snapshot = snapshot,
                                destination = WatchDestination.Outdated(promptId),
                                outdated = outdated,
                                command = null,
                            )
                    }
                }
                .onFailure { error ->
                    mutable.update {
                        it.copy(
                            destination = WatchDestination.Home,
                            command = null,
                            notice =
                                if (error is WatchHttpException && error.status == 404)
                                    "That plan no longer exists. Nothing was changed."
                                else "Couldn't check that notification. Nothing was changed.",
                        )
                    }
                }
        }
    }

    private fun perform(navigateHome: Boolean = true, action: () -> JSONObject?) {
        if (state.value.busy) return
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching(action) }
            result
                .onSuccess { json ->
                    val paired = store.credentials() != null
                    mutable.update {
                        it.copy(
                            busy = false,
                            paired = paired,
                            reachable = true,
                            snapshot = if (paired) json?.let(::parse) ?: it.snapshot else null,
                            destination =
                                if (navigateHome) WatchDestination.Home else it.destination,
                        )
                    }
                }
                .onFailure { error ->
                    val paired = store.credentials() != null
                    if (error is WatchHttpException && error.status == 409) {
                        mutable.update {
                            it.copy(
                                busy = false,
                                destination = WatchDestination.Home,
                                notice =
                                    "Changed on another device. Your watch is up to date again.",
                            )
                        }
                        refresh()
                        return@onFailure
                    }
                    mutable.update {
                        it.copy(
                            busy = false,
                            paired = paired,
                            reachable = false,
                            snapshot = if (paired) it.snapshot else null,
                            error = message(error),
                        )
                    }
                }
        }
    }

    private fun parse(json: JSONObject): Snapshot? =
        runCatching { Snapshot.parse(json) }.getOrNull()

    private fun message(error: Throwable) =
        if (error is java.io.IOException) "Couldn't reach your server."
        else error.message?.takeIf { it.isNotBlank() } ?: "Couldn't reach your server."
}
