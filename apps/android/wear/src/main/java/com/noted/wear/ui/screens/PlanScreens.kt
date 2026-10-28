package com.noted.wear.ui.screens

import android.graphics.Color
import android.text.InputFilter
import android.widget.EditText
import com.noted.wear.data.Plan
import com.noted.wear.data.Prompt
import com.noted.wear.data.WatchData
import com.noted.wear.navigation.WatchDestination
import com.noted.wear.ui.DelayChoices
import com.noted.wear.ui.FINISHING_REASON
import com.noted.wear.ui.WatchUiState
import com.noted.wear.ui.WatchViewModel
import com.noted.wear.ui.WatchViews

fun WatchViews.plan(plan: Plan, model: WatchViewModel) {
    label("PLANNED ACTIVITY")
    text(plan.title, 23f)
    text(WatchData.time(plan.startAt.toString(), plan.timezone), 16f, accent)
    button("Start activity", "play", true) { model.tracker("start", plan.activityId) }
    text("Delay becomes available when this plan's prompt arrives.", 12f, Color.GRAY)
}

fun WatchViews.prompt(prompt: Prompt, model: WatchViewModel) {
    label(if (prompt.ended) "ACTIVITY ENDED" else "PLANNED ACTIVITY")
    text(prompt.title, 23f)
    val at = if (prompt.ended) prompt.plannedEnd ?: prompt.plannedStart else prompt.plannedStart
    text(WatchData.time(at.toString()), 16f, accent)
    button(
        if (prompt.ended) "No activity" else "Start activity",
        if (prompt.ended) "stop" else "play",
        true,
    ) {
        model.promptAction(prompt.id, if (prompt.ended) "stop" else "start")
    }
    button(if (prompt.ended) "Snooze" else "Delay prompt") {
        model.open(WatchDestination.Delay(prompt.id))
    }
    if (!prompt.ended)
        button("Doing something else") { model.open(WatchDestination.OtherActivity(prompt.id)) }
}

/** Delay or snooze needs a reason; the plan itself never moves. */
fun WatchViews.delay(
    prompt: Prompt,
    activityId: String?,
    state: WatchUiState,
    model: WatchViewModel,
) {
    val draft = state.delay
    text(if (prompt.ended) "Snooze prompt" else "Delay prompt", 18f)
    text("Your plan stays in place.", 11f, Color.LTGRAY)
    label("DELAY FROM NOW")
    add(
        DelayChoices(content.context, draft.minutes, accent, scale) { minutes ->
            model.setDelay(draft.copy(minutes = minutes))
        },
    )
    label("REASON / REQUIRED")
    listOf(FINISHING_REASON, "Taking a break", "Something came up").forEach { reason ->
        button(reason, if (draft.reason == reason) "check" else "") {
            model.setDelay(draft.copy(reason = reason))
        }
    }
    val custom =
        EditText(content.context).apply {
            hint = "Or write a reason"
            textSize = 14f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            setSingleLine()
            filters = arrayOf(InputFilter.LengthFilter(500))
        }
    add(custom)
    button(
        if (activityId != null) "Switch and delay"
        else if (prompt.ended) "Snooze prompt" else "Delay prompt",
        primary = true,
    ) {
        val reason = custom.text.toString().trim().ifBlank { draft.reason }
        if (reason.isBlank()) {
            custom.error = "Choose or write a reason"
            return@button
        }
        model.setDelay(draft.copy(reason = reason))
        model.promptAction(prompt.id, if (activityId == null) "delay" else "other", activityId)
    }
}
