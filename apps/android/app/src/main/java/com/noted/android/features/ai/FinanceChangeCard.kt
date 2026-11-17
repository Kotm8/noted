package com.noted.android.features.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.noted.android.data.text
import com.noted.android.ui.NotedCheckbox
import com.noted.android.ui.NotedStyle
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Currency

@Composable
fun FinanceChangeCard(change: JSONObject, checked: Boolean, enabled: Boolean, toggle: (Boolean) -> Unit) {
    val colors = NotedStyle.colors
    val fields = change.optJSONObject("fields") ?: JSONObject()
    val currency = change.text("display_currency", "EUR").ifBlank { "EUR" }
    val format = NumberFormat.getCurrencyInstance().apply { this.currency = Currency.getInstance(currency) }
    fun value(key: String, content: Any): String = when {
        content == JSONObject.NULL -> "None"
        key in listOf("amount", "price", "opening_balance", "gauge_maximum") && content is Number -> format.format(BigDecimal(content.toString()).movePointLeft(2))
        key == "savings_value" && content is Number -> if (change.text("display_savings_mode") == "percent") "$content%" else format.format(BigDecimal(content.toString()).movePointLeft(2))
        key == "photo_ids" && content is JSONArray -> "${content.length()} images"
        content is JSONObject -> content.keys().asSequence().joinToString("\n") { name -> "${name.replace('_', ' ')}: ${value(name, content.get(name))}" }
        content is JSONArray -> (0 until content.length()).joinToString("\n\n") { value("", content.get(it)) }
        else -> content.toString()
    }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(colors.main)
        .border(1.dp, if (checked) colors.border else colors.subtle, RoundedCornerShape(12.dp))
        .clickable(enabled = enabled, role = Role.Checkbox) { toggle(!checked) }.padding(12.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        NotedCheckbox(checked, if (enabled) toggle else null)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Finance · ${change.text("operation")} ${change.text("entity")}", color = colors.muted, fontSize = 12.sp)
            Text(change.text("title", fields.text("name", change.text("id"))), color = colors.text, fontWeight = FontWeight.Medium)
            fields.keys().forEach { key ->
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(key.replace('_', ' '), color = colors.muted, fontSize = 12.sp)
                    Text(value(key, fields.get(key)), color = colors.secondary, fontSize = 14.sp)
                }
            }
        }
    }
}
