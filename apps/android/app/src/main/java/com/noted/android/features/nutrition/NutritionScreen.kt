package com.noted.android.features.nutrition

import androidx.compose.foundation.clickable
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
fun NutritionScreen(repository: NativeRepository) {
    val state = rememberResource(repository, "/nutrition")
    var day by rememberSaveable { mutableStateOf<String?>(null) }
    val selectedDay = day ?: state.obj?.text("today")?.takeIf { it.isNotBlank() } ?: LocalDate.now().toString()
    val meals = rememberResource(repository, "/nutrition/meals?start=$selectedDay&end=$selectedDay")
    var profile by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var target by remember { mutableStateOf(false) }
    var weight by remember { mutableStateOf(false) }
    var savedManager by remember { mutableStateOf(false) }
    var savedEditor by remember { mutableStateOf<JSONObject?>(null) }
    val total = meals.rows.sumOf { meal -> meal.rows("items").sumOf { it.optInt("kcal") } }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            DateField("Food diary", LocalDate.parse(selectedDay)) { day = it.toString() }
            ResourceStatus(meals) { repository.changed() }
            Text("$total kcal", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.headlineMedium)
            state.obj?.optJSONObject("target")?.let { goal ->
                Text("of ${goal.optInt("kcal")} kcal", color = MaterialTheme.colorScheme.onSurfaceVariant)
                NotedProgressIndicator(progress = { (total.toFloat() / goal.optInt("kcal").coerceAtLeast(1)).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                NotedOutlinedButton(onClick = { if (state.obj?.optJSONObject("profile") == null) profile = true else target = true }) { Text(if (state.obj?.optJSONObject("profile") == null) "Set up profile" else "Daily target") }
                if (state.obj?.optJSONObject("profile") != null) NotedTextButton({ profile = true }) { Text("Profile") }
                NotedOutlinedButton(onClick = { weight = true }) { Text("Weigh in") }
            }
            NotedTextButton({ savedManager = true }) { Text("Saved meals") }
        }
        listOf("Breakfast", "Lunch", "Dinner", "Snack").forEach { slot ->
            val entries = meals.rows.filter { it.text("slot") == slot }
            if (entries.isNotEmpty()) item { SectionTitle(slot) }
            items(entries, key = { it.text("id") }) { meal ->
                meal.optJSONArray("photo_ids")?.optString(0)?.takeIf { it.isNotBlank() }?.let { photo ->
                    NativeImage(repository, "/api/v1/nutrition/photos/$photo", meal.text("name"), Modifier.fillMaxWidth().height(140.dp).clickable { editing = meal })
                }
                NotedListItem(headlineContent = { Text(meal.text("name")) }, supportingContent = { Text(meal.rows("items").joinToString(" · ") { it.text("name") }, maxLines = 2) },
                    trailingContent = { Text("${meal.rows("items").sumOf { it.optInt("kcal") }} kcal") }, modifier = Modifier.clickable { editing = meal })
            }
        }
        item { NotedButton(onClick = { editing = json("day" to selectedDay) }, modifier = Modifier.fillMaxWidth()) { Icon(NotedIcons.Add, null); Text("Add meal") } }
    }
    editing?.let { MealEditor(repository, it, state.obj?.rows("saved_meals").orEmpty()) { editing = null } }
    if (profile) NutritionProfile(repository, state.obj?.optJSONObject("profile")) { profile = false }
    if (savedManager) SavedMeals(state.obj?.rows("saved_meals").orEmpty(), { savedManager = false }) { savedEditor = it; savedManager = false }
    savedEditor?.let { MealEditor(repository, it, emptyList(), saved = true) { savedEditor = null } }
    if (target) {
        val existing = state.obj?.optJSONObject("target")
        var kcal by remember { mutableStateOf((existing?.optInt("kcal") ?: 2000).toString()) }
        var protein by remember { mutableStateOf((existing?.optInt("protein") ?: 100).toString()) }
        var carbs by remember { mutableStateOf((existing?.optInt("carbs") ?: 250).toString()) }
        var fat by remember { mutableStateOf((existing?.optInt("fat") ?: 65).toString()) }
        var proposal by remember { mutableStateOf<JSONObject?>(null) }
        var thinking by remember { mutableStateOf(false) }
        var failure by remember { mutableStateOf<String?>(null) }
        val scope = rememberCoroutineScope()
        EditorSheet("Daily nutrition target", { target = false }, enabled = !thinking, save = {
            repository.mutate("/nutrition/target", "PUT", json("kcal" to kcal.toInt(), "protein" to protein.toInt(), "carbs" to carbs.toInt(), "fat" to fat.toInt(),
                "explanation" to (proposal ?: existing)?.text("explanation").orEmpty(), "sources" to ((proposal ?: existing)?.optJSONArray("sources") ?: JSONArray())))
        }) {
            state.obj?.optJSONObject("limits")?.let { limits -> QuietNotice("Server limits: ${limits.optInt("lowest")}–${limits.optInt("highest")} kcal. Maintenance: ${limits.optInt("maintenance")} kcal.") }
            Field("Calories", kcal, { kcal = it }); Field("Protein, g", protein, { protein = it }); Field("Carbohydrates, g", carbs, { carbs = it }); Field("Fat, g", fat, { fat = it })
            NotedOutlinedButton({
                thinking = true; failure = null
                scope.launch {
                    try {
                        var done = false
                        val profileFields = state.obj!!.getJSONObject("profile").copy().apply { remove("revision") }
                        repository.api.stream("/ai/nutrition/target", json("profile" to profileFields)).collect { event ->
                            if (event.text("type") == "error") error(event.text("message"))
                            if (event.text("type") == "done") {
                                proposal = event.getJSONObject("output")
                                kcal = proposal!!.optInt("kcal").toString(); protein = proposal!!.optInt("protein").toString()
                                carbs = proposal!!.optInt("carbs").toString(); fat = proposal!!.optInt("fat").toString(); done = true
                            }
                        }
                        check(done) { "The suggestion was interrupted. Your current target is unchanged." }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (error: Exception) { failure = error.message }
                    finally { thinking = false }
                }
            }, enabled = !thinking) { Text(if (thinking) "Thinking…" else "Suggest with AI") }
            proposal?.let { Markdown(it.text("explanation")); com.noted.android.features.ai.AiSources(repository, it.rows("sources")) }
            failure?.let { QuietNotice(it, true) }
        }
    }
    if (weight) {
        var kilograms by remember { mutableStateOf("") }
        EditorSheet("Weigh in", { weight = false }, enabled = kilograms.toDoubleOrNull()?.let { it in 30.0..300.0 } == true,
            save = { repository.mutate("/nutrition/weigh-ins", "PUT", json("day" to selectedDay, "weight_kg" to kilograms.toDouble())) }) {
            Field("Weight in kg", kilograms, { kilograms = it })
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
