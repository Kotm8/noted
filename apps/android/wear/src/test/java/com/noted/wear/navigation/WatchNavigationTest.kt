package com.noted.wear.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WatchNavigationTest {
    private val prompt = "0b7c3a1e-2f4d-4e6a-9c1b-2a3d4e5f6a7b"
    private val message = "1c8d4b2f-3a5e-4f7b-8d2c-3b4e5f6a7b8c"

    private fun extras(vararg values: Pair<String, Any>) =
        object : NotificationExtras {
            val map = values.toMap()

            override fun string(key: String) = map[key] as? String

            override fun int(key: String) = map[key] as? Int ?: 0

            override fun flag(key: String) = map[key] as? Boolean ?: false
        }

    @Test
    fun notificationTapsOpenTheirScreens() {
        assertEquals(
            WatchDestination.PromptDetails(prompt),
            WatchIntentRouter.route(extras("prompt_id" to prompt)),
        )
        assertEquals(
            WatchDestination.Delay(prompt),
            WatchIntentRouter.route(extras("prompt_id" to prompt, "delay" to true)),
        )
        assertEquals(
            WatchDestination.ReminderDetails(message),
            WatchIntentRouter.route(extras("message_id" to message)),
        )
        assertNull(WatchIntentRouter.route(extras()))
    }

    @Test
    fun startNeedsARevisionAndAKnownAction() {
        assertEquals(
            WatchDestination.Command(prompt, 3, "start"),
            WatchIntentRouter.route(
                extras("prompt_id" to prompt, "action" to "start", "revision" to 3),
            ),
        )
        assertEquals(
            WatchDestination.PromptDetails(prompt),
            WatchIntentRouter.route(
                extras("prompt_id" to prompt, "action" to "delete", "revision" to 3),
            ),
        )
        assertNull(WatchIntentRouter.route(extras("prompt_id" to prompt, "action" to "start")))
    }

    @Test
    fun rejectsIdsThatAreNotUuids() {
        assertNull(WatchIntentRouter.route(extras("prompt_id" to "../device")))
        assertNull(WatchIntentRouter.route(extras("message_id" to "x|y")))
    }

    @Test
    fun theSameTapAlwaysSendsTheSameRequest() {
        val tap = WatchDestination.Command(prompt, 3, "start")
        assertEquals(WatchIntentRouter.requestId(tap), WatchIntentRouter.requestId(tap.copy()))
        assertNotEquals(
            WatchIntentRouter.requestId(tap),
            WatchIntentRouter.requestId(tap.copy(revision = 4)),
        )
    }

    @Test
    fun destinationsSurviveRecreation() {
        listOf(
                WatchDestination.Home,
                WatchDestination.Diagnostics,
                WatchDestination.OtherActivity(prompt),
                WatchDestination.Delay(prompt),
                WatchDestination.Delay(prompt, "activity"),
                WatchDestination.ReminderDetails(message),
                WatchDestination.Command(prompt, 2, "stop"),
                WatchDestination.Outdated(prompt),
            )
            .forEach { assertEquals(it, WatchDestination.decode(it.encode())) }
        assertNull(WatchDestination.decode("command|$prompt|2|delete"))
        assertNull(WatchDestination.decode("unknown"))
    }
}
