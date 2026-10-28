package com.noted.wear.data

import java.time.Instant

enum class OutdatedReason {
    Started,
    Stopped,
    Delayed,
    Moved,
    Ended,
}

/** Why a prompt from an older notification no longer applies, and the time worth showing. */
data class Outdated(
    val reason: OutdatedReason,
    val title: String,
    val activityId: String,
    val at: Instant?,
)

object PromptOutcome {
    /**
     * Returns null while the prompt still waits for an answer. A cancelled or
     * superseded prompt whose plan still exists at another time was moved;
     * otherwise its plan is over.
     */
    fun classify(prompt: Prompt, plans: List<Plan>, now: Instant = Instant.now()): Outdated? {
        val reason =
            when (prompt.status) {
                "started" -> OutdatedReason.Started
                "stopped" -> OutdatedReason.Stopped
                "pending" ->
                    if (prompt.notifyAt.isAfter(now)) OutdatedReason.Delayed else return null
                else -> {
                    val moved =
                        plans.find {
                            it.id == prompt.planId &&
                                it.startAt != prompt.plannedStart &&
                                it.endAt.isAfter(now)
                        }
                    if (moved != null)
                        return Outdated(
                            OutdatedReason.Moved,
                            prompt.title,
                            prompt.activityId,
                            moved.startAt,
                        )
                    OutdatedReason.Ended
                }
            }
        val at =
            when (reason) {
                OutdatedReason.Delayed -> prompt.notifyAt
                OutdatedReason.Ended -> prompt.plannedEnd ?: prompt.plannedStart
                else -> null
            }
        return Outdated(reason, prompt.title, prompt.activityId, at)
    }
}
