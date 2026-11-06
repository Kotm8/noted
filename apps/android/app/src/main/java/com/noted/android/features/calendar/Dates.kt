package com.noted.android.features.calendar

import android.net.Uri
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

fun schedulePath(start: LocalDate, endExclusive: LocalDate, timezone: String): String {
    val zone = ZoneId.of(timezone)
    return "/schedule?start=${Uri.encode(start.atStartOfDay(zone).toOffsetDateTime().toString())}&end=${Uri.encode(endExclusive.atStartOfDay(zone).toOffsetDateTime().toString())}"
}

fun dayOff(day: LocalDate, schedule: JSONObject?): Boolean {
    val override = schedule?.optJSONObject("overrides")?.optString(day.toString())
    if (override == "off") return true
    if (override == "work") return false
    if (schedule?.optString("mode") == "cycle") {
        val anchor = runCatching { LocalDate.parse(schedule.optString("cycle_start")) }.getOrNull() ?: return false
        val work = schedule.optInt("work_days", 2); val off = schedule.optInt("off_days", 2)
        return Math.floorMod(ChronoUnit.DAYS.between(anchor, day), (work + off).coerceAtLeast(1).toLong()) >= work
    }
    val days = schedule?.optJSONArray("off_weekdays") ?: return day.dayOfWeek.value in 6..7
    return (0 until days.length()).any { days.optInt(it) == day.dayOfWeek.value - 1 }
}
