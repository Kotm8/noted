package com.noted.wear.ui.screens

import android.graphics.Color
import com.noted.wear.data.Reminder
import com.noted.wear.data.WatchData
import com.noted.wear.ui.WatchViewModel
import com.noted.wear.ui.WatchViews

fun WatchViews.reminder(reminder: Reminder, snoozeMinutes: Int, model: WatchViewModel) {
    label("REMINDER / ${WatchData.time(reminder.dueAt.toString())}")
    text(reminder.content, 18f)
    text("${reminder.workspaceName} / ${reminder.channelName}", 12f, Color.GRAY)
    button("Done", "check", true) { model.reminderAction(reminder.messageId, "done") }
    button("Snooze $snoozeMinutes minutes") {
        model.reminderAction(reminder.messageId, "snooze", snoozeMinutes)
    }
}
