package com.noted.wear.navigation

/** Every screen the watch app can show, encodable so it survives recreation. */
sealed interface WatchDestination {
    data object Home : WatchDestination

    data object Upcoming : WatchDestination

    data object Activities : WatchDestination

    /** Choosing what to do instead of a prompted plan, before picking a delay. */
    data class OtherActivity(val promptId: String) : WatchDestination

    data class PlanDetails(val planId: String) : WatchDestination

    data class PromptDetails(val promptId: String) : WatchDestination

    data class Delay(val promptId: String, val activityId: String? = null) : WatchDestination

    data class ReminderDetails(val messageId: String) : WatchDestination

    data object Settings : WatchDestination

    data object Diagnostics : WatchDestination

    /** A Start or No activity tapped on a notification, sent once and confirmed by the server. */
    data class Command(val promptId: String, val revision: Int, val action: String) :
        WatchDestination

    data class Outdated(val promptId: String) : WatchDestination

    fun encode(): String =
        when (this) {
            Home -> "home"
            Upcoming -> "upcoming"
            Activities -> "activities"
            Settings -> "settings"
            Diagnostics -> "diagnostics"
            is OtherActivity -> "other|$promptId"
            is PlanDetails -> "plan|$planId"
            is PromptDetails -> "prompt|$promptId"
            is Delay -> "delay|$promptId|${activityId.orEmpty()}"
            is ReminderDetails -> "reminder|$messageId"
            is Command -> "command|$promptId|$revision|$action"
            is Outdated -> "outdated|$promptId"
        }

    companion object {
        fun decode(value: String?): WatchDestination? {
            val parts = value?.split("|") ?: return null
            fun part(index: Int) = parts.getOrNull(index)?.takeIf { it.isNotEmpty() }
            return when (parts.first()) {
                "home" -> Home
                "upcoming" -> Upcoming
                "activities" -> Activities
                "settings" -> Settings
                "diagnostics" -> Diagnostics
                "other" -> part(1)?.let(::OtherActivity)
                "plan" -> part(1)?.let(::PlanDetails)
                "prompt" -> part(1)?.let(::PromptDetails)
                "delay" -> part(1)?.let { Delay(it, part(2)) }
                "reminder" -> part(1)?.let(::ReminderDetails)
                "command" -> {
                    val id = part(1) ?: return null
                    val revision = part(2)?.toIntOrNull() ?: return null
                    val action = part(3)?.takeIf { it in COMMANDS } ?: return null
                    Command(id, revision, action)
                }
                "outdated" -> part(1)?.let(::Outdated)
                else -> null
            }
        }

        val COMMANDS = setOf("start", "stop")
    }
}
