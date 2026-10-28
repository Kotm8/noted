package com.noted.wear.navigation

import java.util.UUID

/** The extras a Noted notification puts on the intent that opens the watch app. */
interface NotificationExtras {
    fun string(key: String): String?

    fun int(key: String): Int

    fun flag(key: String): Boolean
}

/**
 * Turns a launch or notification intent into a destination. A cold launch and
 * onNewIntent go through here alike, so taps behave the same either way.
 */
object WatchIntentRouter {
    const val PROMPT = "prompt_id"
    const val MESSAGE = "message_id"
    const val DELAY = "delay"
    const val ACTION = "action"
    const val REVISION = "revision"

    fun route(extras: NotificationExtras): WatchDestination? {
        val prompt = extras.string(PROMPT)?.takeIf(::isId)
        val message = extras.string(MESSAGE)?.takeIf(::isId)
        val action = extras.string(ACTION)
        return when {
            prompt != null && action in WatchDestination.COMMANDS ->
                extras.int(REVISION).takeIf { it > 0 }?.let {
                    WatchDestination.Command(prompt, it, action!!)
                }
            prompt != null && extras.flag(DELAY) -> WatchDestination.Delay(prompt)
            prompt != null -> WatchDestination.PromptDetails(prompt)
            message != null -> WatchDestination.ReminderDetails(message)
            else -> null
        }
    }

    /**
     * The same tap always produces the same request id, so the server applies it
     * once even if the watch sends it again after a retry or recreation.
     */
    fun requestId(command: WatchDestination.Command): String =
        UUID.nameUUIDFromBytes(
                "${command.promptId}:${command.revision}:${command.action}".toByteArray(),
            )
            .toString()

    private fun isId(value: String) = runCatching { UUID.fromString(value) }.isSuccess
}
