package com.noted.android.features.channels

import org.junit.Assert.*
import org.junit.Test

class ReminderCommandTest {
    @Test fun documentCommandRunsOnlyWhenEnterFinishesItsLine() {
        val source = "My notes\n/remind Call the dentist"
        val command = documentReminderChange(source, "$source\n")!!
        assertEquals("Call the dentist", command.reminder.content)
        assertTrue(command.linkedContent().startsWith("My notes\n[Call the dentist](#reminder-"))
        assertNull(documentReminderChange(source, source + " pasted\ntext"))
        val code = "```\n/remind code"
        assertNull(documentReminderChange(code, "$code\n"))
    }
    @Test fun namedReminderDoesNotRequireAnInlineTime() {
        assertEquals(ReminderCommand("Call the dentist"), parseReminderCommand("/remind Call the dentist"))
        assertEquals(ReminderCommand("Call the dentist"), parseReminderCommand("/REMIND Call the dentist"))
        assertNull(parseReminderCommand("/reminder Call the dentist"))
        assertNull(parseReminderCommand("Remember to call the dentist"))
    }

    @Test fun optionalTimePreservesTheWholeReminder() {
        assertEquals(ReminderCommand("Call\nthe dentist", 120), parseReminderCommand("/remind 2h Call\nthe dentist"))
        assertEquals(ReminderCommand("Take a break", 1), parseReminderCommand("/remind 0m Take a break"))
        assertEquals(ReminderCommand("Check in", 525600), parseReminderCommand("/remind 999999999999999999999d Check in"))
        assertEquals(ReminderCommand(""), parseReminderCommand("/remind"))
    }
}
