package com.noted.android.features.nutrition

import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.features.ai.stream
import com.noted.android.features.media.PhotoPicker
import com.noted.android.features.media.NativeImage
import com.noted.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

@Composable
fun NutritionScreen(repository: NativeRepository, logMeal: () -> Unit) {
    val state = rememberResource(repository, "/nutrition")
    var day by rememberSaveable { mutableStateOf<String?>(null) }
    val selectedDay = day ?: state.obj?.text("today")?.takeIf { it.isNotBlank() } ?: LocalDate.now().toString()
    val selected = LocalDate.parse(selectedDay)
    val meals = rememberResource(repository, "/nutrition/meals?start=$selectedDay&end=$selectedDay")
    val week = rememberResource(repository, "/nutrition/days?start=${selected.minusDays(6)}&end=$selectedDay")
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var weight by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val origin = repository.session.collectAsState().value?.origin
    val colors = NotedStyle.colors
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            DateField("Food diary", selected) { day = it.toString() }
            ResourceStatus(state) { repository.changed("nutrition") }
            ResourceStatus(meals) { repository.changed("nutrition") }
            NutritionSummary(meals.rows, state.obj?.optJSONObject("target"))
            DesignLabel("Meals")
        }
        items(meals.rows.sortedBy { it.optInt("minute") }, key = { it.text("id") }) { meal ->
            NotedListItem(headlineContent = { Text(meal.text("slot")) }, supportingContent = {
                Text("${meal.text("name")} \u00b7 ${minuteLabel(meal.optInt("minute"))}", maxLines = 2)
            }, leadingContent = {
                meal.optJSONArray("photo_ids")?.optString(0)?.takeIf { it.isNotBlank() }?.let { photo ->
                    NativeImage(repository, "/api/v1/nutrition/photos/$photo", meal.text("name"), Modifier.size(48.dp).clip(RoundedCornerShape(8.dp)))
                } ?: Icon(NotedIcons.Restaurant, null, Modifier.size(28.dp), tint = colors.muted)
            }, trailingContent = { Text("${meal.rows("items").sumOf { it.optInt("kcal") }}", color = colors.secondary) },
                modifier = Modifier.clickable { editing = meal })
        }
        if (meals.rows.isEmpty() && !meals.refreshing && meals.error == null) item { Text("No meals logged for this day.", color = colors.muted) }
        item {
            PillButton(logMeal, Modifier.fillMaxWidth(), primary = true) { Icon(NotedIcons.Camera, null, Modifier.size(18.dp)); Text("Log meal") }
            NotedTextButton({ editing = json("day" to selectedDay) }, Modifier.fillMaxWidth()) { Text("Add a meal by hand") }
        }
        item {
            ResourceStatus(week) { repository.changed("nutrition") }
            NutritionWeek(week.rows, selected) { day = it.toString() }
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton({ weight = true }) { Text("Weigh in") }
                PillButton({ origin?.let { openOnWeb(context, it, "/home?settings=nutrition") } }, enabled = origin != null) {
                    Icon(NotedIcons.ExternalLink, null, Modifier.size(16.dp)); Text("Profile and target")
                }
            }
        }
    }
    editing?.let { MealEditor(repository, it, state.obj?.rows("saved_meals").orEmpty()) { editing = null } }
    if (weight) {
        var kilograms by remember { mutableStateOf("") }
        val actions = rememberActions()
        DesignSheet({ weight = false }, "Weigh in") {
            DesignLabel("Weight in kg")
            Field("Weight", kilograms, { kilograms = it })
            PillButton({ actions.run {
                repository.mutate("/nutrition/weigh-ins", "PUT", json("day" to selectedDay, "weight_kg" to kilograms.toDouble()))
                weight = false
            } }, Modifier.fillMaxWidth().padding(top = 20.dp), primary = true,
                enabled = !actions.busy && kilograms.toDoubleOrNull()?.let { it.isFinite() && it in 30.0..300.0 } == true) { Text("Save") }
        }
    }
}

@Composable
private fun MealEditor(repository: NativeRepository, meal: JSONObject, savedMeals: List<JSONObject>, saved: Boolean = false, close: () -> Unit) {
    val now = LocalTime.now()
    var name by remember { mutableStateOf(meal.text("name")) }
    var slot by remember { mutableStateOf(meal.text("slot", "Snack")) }
    var minute by remember { mutableIntStateOf(meal.optInt("minute", now.hour * 60 + now.minute)) }
    var date by remember { mutableStateOf(LocalDate.parse(meal.text("day", LocalDate.now().toString()))) }
    var items by remember { mutableStateOf(meal.rows("items")) }
    var rememberMeal by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf(false) }
    var description by remember { mutableStateOf("") }
    var estimating by remember { mutableStateOf(false) }
    var estimateError by remember { mutableStateOf<String?>(null) }
    var photos by remember { mutableStateOf(meal.optJSONArray("photo_ids")?.let { rows -> (0 until rows.length()).map { rows.getString(it) } }.orEmpty()) }
    var uploading by remember { mutableStateOf(false) }
    var itemSource by remember { mutableStateOf(meal.text("source", "manual")) }
    var savedId by remember { mutableStateOf(meal.text("saved_meal_id")) }
    val scope = rememberCoroutineScope()
    val id = meal.text("id")
    if (removing) {
        ConfirmDelete("Delete meal?", { removing = false }) {
            repository.mutate(if (saved) "/nutrition/saved-meals/$id" else "/nutrition/meals/$id?revision=${meal.optInt("revision")}", "DELETE"); close()
        }
        return
    }
    EditorSheet(if (saved) "Saved meal" else if (id.isBlank()) "Add meal" else "Edit meal", close, enabled = name.isNotBlank() && validMealItems(items) && !estimating && !uploading, save = {
        val fields = if (saved) json("name" to name, "items" to mealItems(items)) else json("name" to name, "day" to date.toString(), "minute" to minute, "slot" to slot, "items" to mealItems(items), "remember" to rememberMeal,
            "source" to itemSource, "saved_meal_id" to savedId.takeIf { it.isNotBlank() }, "photo_ids" to JSONArray(photos))
        if (id.isNotBlank()) fields.put("revision", meal.optInt("revision"))
        val base = if (saved) "/nutrition/saved-meals" else "/nutrition/meals"
        repository.mutate(if (id.isBlank()) base else "$base/$id", if (id.isBlank()) "POST" else "PUT", fields)
    }) {
        if (!saved && savedMeals.isNotEmpty()) Choice("Saved meal", "", listOf("" to "Choose a saved meal") + savedMeals.map { it.text("id") to it.text("name") }) { selected ->
            savedMeals.firstOrNull { it.text("id") == selected }?.let { name = it.text("name"); items = it.rows("items"); savedId = it.text("id"); itemSource = "saved" }
        }
        Field("Meal name", name, { name = it })
        if (!saved) {
            Choice("Meal", slot, listOf("Breakfast", "Lunch", "Dinner", "Snack").map { it to it }) { slot = it }
            DateField("Date", date) { date = it }; TimeField("Time", minute) { minute = it }
            PhotoPicker(repository, photos, enabled = !estimating, busy = { uploading = it }) { photos = it }
        }
        items.forEachIndexed { index, item ->
            SectionTitle("Food ${index + 1}")
            fun change(key: String, value: Any) { items = items.mapIndexed { i, row -> if (i == index) row.copy().put(key, value) else row } }
            Field("Food", item.text("name"), { change("name", it) })
            Field("Portion", item.text("amount"), { change("amount", it) })
            Field("Calories", item.text("kcal", "0"), { change("kcal", it) })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("protein" to "Protein", "carbs" to "Carbs", "fat" to "Fat").forEach { (key, label) ->
                    Field(label, item.text(key, "0"), { change(key, it) }, Modifier.weight(1f))
                }
            }
            NotedTextButton(onClick = { items = items.filterIndexed { i, _ -> i != index } }) { Text("Remove food") }
        }
        NotedOutlinedButton(onClick = { items = items + json("name" to "", "amount" to "", "kcal" to 0, "protein" to 0, "carbs" to 0, "fat" to 0, "confidence" to "high") }, modifier = Modifier.fillMaxWidth()) { Text("Add food manually") }
        Field("Or describe what you ate", description, { description = it }, singleLine = false)
        NotedOutlinedButton(enabled = (description.isNotBlank() || photos.isNotEmpty()) && !estimating && !uploading, onClick = {
            estimating = true; estimateError = null
            scope.launch {
                try {
                    var done = false
                    repository.api.stream("/ai/nutrition/estimate", json("text" to description, "photo_ids" to JSONArray(photos), "slot" to slot)).collect { event ->
                        if (event.text("type") == "error") throw java.io.IOException(event.text("message"))
                        if (event.text("type") == "done") {
                            val output = event.getJSONObject("output"); name = output.text("name"); items = output.rows("items"); itemSource = "ai"; done = true
                        }
                    }
                    check(done) { "The estimate was interrupted. Try again." }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { estimateError = failure.message }
                finally { estimating = false }
            }
        }, modifier = Modifier.fillMaxWidth()) { Text(if (estimating) "Estimating…" else "Estimate with AI") }
        estimateError?.let { QuietNotice(it, true) }
        if (!saved) Toggle("Save as a reusable meal", rememberMeal) { rememberMeal = it }
        if (id.isNotBlank()) NotedTextButton(onClick = { removing = true }) { Text("Delete meal", color = MaterialTheme.colorScheme.error) }
    }
}
