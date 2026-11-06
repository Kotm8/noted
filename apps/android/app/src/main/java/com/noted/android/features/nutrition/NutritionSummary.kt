package com.noted.android.features.nutrition

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable
fun NutritionSummary(meals: List<JSONObject>, target: JSONObject?) {
    val colors = NotedStyle.colors
    val items = meals.flatMap { it.rows("items") }
    val kcal = items.sumOf { it.optInt("kcal") }
    val goal = target?.optInt("kcal") ?: 0
    Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp)) {
        Box(Modifier.size(150.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize().padding(6.dp)) {
                val stroke = Stroke(10.dp.toPx(), cap = StrokeCap.Round)
                drawArc(colors.input, 0f, 360f, false, style = stroke)
                if (goal > 0) drawArc(if (kcal > goal) colors.danger else colors.accent, -90f,
                    360f * (kcal.toFloat() / goal).coerceIn(0f, 1f), false, style = stroke)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("%,d".format(kcal), style = MaterialTheme.typography.displayLarge)
                Text(if (goal > 0) "of %,d kcal".format(goal) else "kcal", color = colors.muted, style = MaterialTheme.typography.bodySmall)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(if (goal > 0 && kcal > goal) "Over target" else "Left today", color = colors.muted, style = MaterialTheme.typography.bodySmall)
            Text(if (goal > 0) "%,d kcal".format(kotlin.math.abs(goal - kcal)) else "No target set",
                style = MaterialTheme.typography.headlineSmall, color = if (goal > 0 && kcal > goal) colors.danger else colors.text)
        }
    }
    listOf("protein" to "Protein", "carbs" to "Carbs", "fat" to "Fat").forEach { (key, label) ->
        val total = items.sumOf { it.optDouble(key, 0.0) }
        val amount = target?.optInt(key) ?: 0
        Column(Modifier.padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Text(if (amount > 0) "${total.toInt()} of $amount g" else "${total.toInt()} g", color = colors.muted, style = MaterialTheme.typography.bodySmall)
            }
            NotedProgressIndicator({ if (amount > 0) (total / amount).toFloat().coerceIn(0f, 1f) else 0f }, Modifier.fillMaxWidth().height(4.dp))
        }
    }
}

@Composable
fun NutritionWeek(days: List<JSONObject>, selected: LocalDate, select: (LocalDate) -> Unit) {
    val colors = NotedStyle.colors
    val week = (6L downTo 0L).map { selected.minusDays(it) }
    val totals = days.associate { it.text("day") to it.optInt("kcal") }
    val highest = maxOf(1, totals.values.maxOrNull() ?: 0)
    DesignLabel("This week")
    Row(Modifier.fillMaxWidth().height(120.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Bottom) {
        week.forEach { day ->
            val value = totals[day.toString()] ?: 0
            Column(Modifier.weight(1f).fillMaxHeight().clickable(onClickLabel = "Open food diary for $day") { select(day) }
                .semantics { contentDescription = "$day: $value kcal" }, verticalArrangement = Arrangement.Bottom,
                horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.fillMaxWidth().height((80f * value / highest).coerceAtLeast(2f).dp)
                    .clip(RoundedCornerShape(4.dp)).background(if (day == selected) colors.accent else colors.accentSurface))
                Text(day.format(DateTimeFormatter.ofPattern("EEEEE")), Modifier.padding(top = 6.dp), color = colors.muted, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
