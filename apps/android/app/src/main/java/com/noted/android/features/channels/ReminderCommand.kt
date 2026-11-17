package com.noted.android.features.channels

data class ReminderCommand(val content: String, val delayMinutes: Long = 60)

fun parseReminderCommand(text: String): ReminderCommand? {
    if (!Regex("^/remind(?:\\s|$)", RegexOption.IGNORE_CASE).containsMatchIn(text)) return null
    val body = text.substring(7).trimStart()
    val match = Regex("^(\\d+)([mhd])\\s+([\\s\\S]+)$", RegexOption.IGNORE_CASE).matchEntire(body)
        ?: return ReminderCommand(body)
    val amount = match.groupValues[1].toLongOrNull()?.coerceAtMost(525600) ?: 525600
    val unit = when (match.groupValues[2].lowercase()) {
        "h" -> 60
        "d" -> 1440
        else -> 1
    }
    return ReminderCommand(match.groupValues[3], (amount * unit).coerceIn(1, 525600))
}
