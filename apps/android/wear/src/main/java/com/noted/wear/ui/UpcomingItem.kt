package com.noted.wear.ui

import com.noted.wear.data.Snapshot
import com.noted.wear.data.WatchData
import com.noted.wear.navigation.WatchDestination
import java.time.Instant

data class UpcomingItem(
    val kind: String,
    val title: String,
    val subtitle: String,
    val at: Instant,
    val destination: WatchDestination,
) {
    companion object {
        fun from(snapshot: Snapshot): List<UpcomingItem> {
            val prompted = snapshot.prompts.map { it.planId }.toSet()
            val prompts =
                snapshot.prompts.map {
                    UpcomingItem(
                        "prompt",
                        it.title,
                        if (it.ended) "Activity ended" else "Activity prompt",
                        it.notifyAt,
                        WatchDestination.PromptDetails(it.id),
                    )
                }
            val plans =
                snapshot.upcomingPlans().filter { it.id !in prompted }.map {
                    UpcomingItem(
                        "plan",
                        it.title,
                        WatchData.time(it.startAt.toString(), it.timezone),
                        it.startAt,
                        WatchDestination.PlanDetails(it.id),
                    )
                }
            val reminders =
                snapshot.reminders.map {
                    UpcomingItem(
                        "reminder",
                        it.content.take(100).ifBlank { "Reminder" },
                        "${WatchData.time(it.dueAt.toString())} / ${it.channelName}",
                        it.dueAt,
                        WatchDestination.ReminderDetails(it.messageId),
                    )
                }
            return (prompts + plans + reminders).sortedBy { it.at }
        }
    }
}
