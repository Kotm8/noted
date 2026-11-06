package com.noted.android.features.nutrition

import android.content.ActivityNotFoundException
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.noted.android.data.*
import com.noted.android.features.ai.stream
import com.noted.android.features.media.NativeImage
import com.noted.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

private data class MealDraft(val name: String, val slot: String, val items: List<JSONObject>, val source: String,
    val savedId: String? = null, val question: JSONObject? = null, val note: String = "")

/**
 * Logging a meal from pictures, a sentence, or both (phone home story 10). The system camera opens
 * straight away; closing it leaves the text box. Saved and recent meals are chips that copy their
 * foods without an AI run, while typed requests such as "same breakfast as yesterday" go to the
 * estimate, which already sees those meals. Nothing is saved until Save meal.
 */
@Composable
fun LogMeal(repository: NativeRepository, shared: List<Uri>, close: () -> Unit, saved: (String) -> Unit) {
    val colors = NotedStyle.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state = rememberResource(repository, "/nutrition")
    val today = state.obj?.text("today")?.takeIf { it.isNotBlank() }?.let(LocalDate::parse) ?: LocalDate.now()
    val recent = rememberResource(repository, "/nutrition/meals?start=${today.minusDays(7)}&end=$today")
    val savedMeals = state.obj?.rows("saved_meals").orEmpty()
    var photos by remember { mutableStateOf(emptyList<String>()) }
    var uploading by remember { mutableStateOf(false) }
    var text by rememberSaveable { mutableStateOf("") }
    var sent by remember { mutableStateOf("") }
    var draft by remember { mutableStateOf<MealDraft?>(null) }
    var streamed by remember { mutableStateOf(emptyList<JSONObject>()) }
    var status by remember { mutableStateOf("") }
    var estimating by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var job by remember { mutableStateOf<Job?>(null) }
    var saving by remember { mutableStateOf(false) }
    var rememberMeal by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Int?>(null) }
    var shot by rememberSaveable { mutableStateOf<String?>(null) }

    fun upload(uris: List<Uri>, temporary: Boolean = false) {
        if (uris.isEmpty()) return
        scope.launch {
            uploading = true; failure = null
            try {
                for (uri in uris.take(4 - photos.size)) {
                    photos = photos + JSONObject(repository.api.uploadFile(context, "/nutrition/photos", uri, maxBytes = 25L * 1024 * 1024)).text("id")
                    if (temporary) uri.lastPathSegment?.let { File(File(context.cacheDir, "meal-photos"), it).delete() }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { failure = error.message ?: "The photo didn't upload. Try again." }
            finally { uploading = false }
        }
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        shot?.let { uri -> if (ok) upload(listOf(Uri.parse(uri)), temporary = true) }
        shot = null
    }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { upload(it) }
    fun takePhoto() {
        val file = File(context.cacheDir, "meal-photos").apply { mkdirs() }.resolve("meal-${System.currentTimeMillis()}.jpg")
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        shot = uri.toString()
        try { camera.launch(uri) } catch (_: ActivityNotFoundException) { shot = null; failure = "No camera app is available. Choose a photo instead." }
    }
    fun pickPhotos() = gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    LaunchedEffect(Unit) { if (shared.isNotEmpty()) upload(shared) else takePhoto() }

    fun estimate(said: String) {
        job?.cancel()
        sent = said; draft = null; streamed = emptyList(); failure = null; estimating = true; status = "Looking at your meal…"
        job = scope.launch {
            try {
                var done = false
                repository.api.stream("/ai/nutrition/estimate", json("text" to said, "photo_ids" to JSONArray(photos))).collect { event ->
                    when (event.text("type")) {
                        "error" -> throw java.io.IOException(event.text("message").ifBlank { "The estimate failed. Try again." })
                        "search" -> status = event.text("query").takeIf { it.isNotBlank() }?.let { "Looking up $it" } ?: "Searching…"
                        "items" -> { streamed = event.rows("items"); status = "Writing it up…" }
                        "done" -> {
                            val output = event.getJSONObject("output")
                            draft = MealDraft(output.text("name").ifBlank { "Meal" }, output.text("slot").ifBlank { slotAt(LocalTime.now()) },
                                output.rows("items"), "ai", savedMeals.firstOrNull { it.text("name") == output.text("saved_meal") }?.text("id"),
                                output.optJSONObject("question"), output.text("note"))
                            done = true
                        }
                    }
                }
                check(done) { "The estimate was interrupted. Try again." }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { failure = error.message ?: "The estimate failed. Try again." }
            finally { estimating = false }
        }
    }
    fun reuse(meal: JSONObject, savedId: String?) {
        job?.cancel(); estimating = false; failure = null
        sent = ""
        draft = MealDraft(meal.text("name"), slotAt(LocalTime.now()), meal.rows("items").map { it.copy() }, if (savedId != null) "saved" else "manual", savedId)
    }
    val reviewing = draft != null || estimating || (failure != null && sent.isNotBlank())
    fun back() { if (reviewing) { job?.cancel(); estimating = false; draft = null; failure = null; sent = "" } else close() }

    Dialog(::back, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        CompositionLocalProvider(LocalContentColor provides colors.text) {
            Column(Modifier.fillMaxSize().background(colors.main).systemBarsPadding().imePadding()) {
                Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(::back) { Icon(if (reviewing) NotedIcons.ArrowBack else NotedIcons.Close, if (reviewing) "Back" else "Close", tint = colors.text) }
                    Text(draft?.slot ?: "Log meal", Modifier.weight(1f).padding(start = 4.dp), color = colors.text, fontSize = 20.sp, fontWeight = FontWeight.Medium)
                    if (reviewing) Text(minuteLabel(LocalTime.now().let { it.hour * 60 + it.minute }), Modifier.padding(end = 16.dp), color = colors.muted)
                }
                if (!reviewing) {
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (photos.isNotEmpty() || uploading) PhotoStrip(repository, photos, uploading) { id -> photos = photos - id }
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            BigChoice(NotedIcons.Camera, "Camera", Modifier.weight(1f), photos.size < 4 && !uploading, ::takePhoto)
                            BigChoice(NotedIcons.Image, "Gallery", Modifier.weight(1f), photos.size < 4 && !uploading, ::pickPhotos)
                        }
                        Text("A photo, a sentence, or both. Try \"only ate half the rice, plus a coke\" or \"same breakfast as yesterday\".",
                            color = colors.muted, fontSize = 14.sp)
                        failure?.let { QuietNotice(it, true) }
                    }
                    Composer(text, { text = it }, savedMeals, recentMeals(recent.rows, savedMeals), photos.isNotEmpty(), !uploading,
                        { meal -> reuse(meal, meal.text("id").takeIf { meal in savedMeals }) }) { estimate(text.trim()) }
                } else {
                    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp)) {
                        draft?.let { meal ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(bottom = 12.dp)) {
                                listOf("Breakfast", "Lunch", "Dinner", "Snack").forEach { slot ->
                                    PillChip(slot, meal.slot == slot, { draft = meal.copy(slot = slot) })
                                }
                            }
                        }
                        if (photos.isNotEmpty() || sent.isNotBlank()) Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(bottom = 8.dp)) {
                            photos.firstOrNull()?.let { NativeImage(repository, "/api/v1/nutrition/photos/$it", "Meal photo", Modifier.size(72.dp).clip(RoundedCornerShape(10.dp))) }
                            if (sent.isNotBlank()) Text("\"$sent\"", color = colors.muted, fontStyle = FontStyle.Italic, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        }
                        val items = draft?.items ?: streamed
                        items.forEachIndexed { index, item ->
                            FoodRow(item, enabled = draft != null) { editing = index }
                        }
                        if (estimating) {
                            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                CircularProgressIndicator(Modifier.size(18.dp), color = colors.accent, strokeWidth = 2.dp)
                                Text(status, color = colors.muted)
                            }
                        }
                        if (items.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (draft == null) "So far" else "Total", Modifier.weight(1f), color = colors.muted)
                            Text("${items.sumOf { it.text("kcal").toIntOrNull() ?: 0 }} kcal", color = colors.text, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                        }
                        draft?.let { meal ->
                            meal.question?.let { question ->
                                FollowUp(question, { choice ->
                                    val updated = meal.items.mapIndexed { i, row ->
                                        if (i != choice.optInt("item")) row else row.copy().apply {
                                            listOf("kcal", "protein", "carbs", "fat").forEach { key -> put(key, choice.opt(key)) }
                                            put("amount", choice.text("label"))
                                        }
                                    }
                                    draft = meal.copy(items = updated, question = null)
                                }, { answer -> estimate(listOf(sent, "${question.text("text")} $answer").filter { it.isNotBlank() }.joinToString("\n")) }) {
                                    draft = meal.copy(question = null)
                                }
                            }
                            if (meal.note.isNotBlank()) QuietNotice(meal.note)
                            Toggle("Save as a reusable meal", rememberMeal) { rememberMeal = it }
                        }
                        failure?.let {
                            QuietNotice(it, true)
                            if (sent.isNotBlank()) NotedOutlinedButton({ estimate(sent) }, Modifier.fillMaxWidth()) { Text("Try again") }
                        }
                        Spacer(Modifier.height(16.dp))
                    }
                    draft?.let { meal ->
                        val kcal = meal.items.sumOf { it.text("kcal").toIntOrNull() ?: 0 }
                        PillButton(onClick = {
                            saving = true; failure = null
                            scope.launch {
                                try {
                                    val now = LocalTime.now()
                                    repository.mutate("/nutrition/meals", "POST", json("name" to meal.name, "day" to today.toString(),
                                        "minute" to now.hour * 60 + now.minute, "slot" to meal.slot, "items" to mealItems(meal.items), "source" to meal.source,
                                        "saved_meal_id" to meal.savedId, "photo_ids" to JSONArray(photos), "remember" to rememberMeal))
                                    repository.changed()
                                    saved("${meal.slot} saved · $kcal kcal")
                                    close()
                                } catch (cancelled: CancellationException) { throw cancelled }
                                catch (error: Exception) { failure = error.message ?: "The meal wasn't saved. Try again." }
                                finally { saving = false }
                            }
                        }, enabled = !saving && validMealItems(meal.items), modifier = Modifier.fillMaxWidth().padding(16.dp).height(48.dp), primary = true) {
                            Text(if (saving) "Saving…" else "Save meal")
                        }
                    }
                }
            }
        }
        editing?.let { index ->
            draft?.items?.getOrNull(index)?.let { item ->
                FoodEditor(item, { editing = null }, {
                    draft = draft?.let { it.copy(items = it.items.filterIndexed { i, _ -> i != index }) }; editing = null
                }) { changed ->
                    draft = draft?.let { it.copy(items = it.items.mapIndexed { i, row -> if (i == index) changed else row }) }
                }
            }
        }
    }
}

private fun slotAt(time: LocalTime) = when (time.hour * 60 + time.minute) {
    in 300 until 660 -> "Breakfast"; in 660 until 960 -> "Lunch"; in 1020 until 1350 -> "Dinner"; else -> "Snack"
}

/** Recent meals not already saved, newest first and one per name, so the chips stay short. */
private fun recentMeals(meals: List<JSONObject>, saved: List<JSONObject>): List<JSONObject> {
    val savedNames = saved.map { it.text("name").lowercase() }.toSet()
    return meals.sortedWith(compareByDescending<JSONObject> { it.text("day") }.thenByDescending { it.optInt("minute") })
        .distinctBy { it.text("name").lowercase() }.filter { it.text("name").lowercase() !in savedNames }.take(6)
}

@Composable
private fun PhotoStrip(repository: NativeRepository, photos: List<String>, uploading: Boolean, remove: (String) -> Unit) {
    val colors = NotedStyle.colors
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(photos, key = { it }) { id ->
            Box(Modifier.size(120.dp).clip(RoundedCornerShape(12.dp))) {
                NativeImage(repository, "/api/v1/nutrition/photos/$id", "Meal photo", Modifier.fillMaxSize())
                IconButton({ remove(id) }, Modifier.align(Alignment.TopEnd).padding(4.dp).size(32.dp).background(colors.main.copy(alpha = .7f), CircleShape)) {
                    Icon(NotedIcons.Close, "Remove photo", Modifier.size(16.dp), tint = colors.text)
                }
            }
        }
        if (uploading) item {
            Box(Modifier.size(120.dp).clip(RoundedCornerShape(12.dp)).background(colors.floating), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(24.dp), color = colors.accent, strokeWidth = 2.dp)
            }
        }
    }
}

@Composable
private fun BigChoice(icon: ImageVector, label: String, modifier: Modifier, enabled: Boolean, action: () -> Unit) {
    val colors = NotedStyle.colors
    Column(modifier.height(96.dp).clip(RoundedCornerShape(14.dp)).background(colors.floating).border(1.dp, colors.subtle, RoundedCornerShape(14.dp))
        .clickable(enabled = enabled, role = Role.Button, onClick = action), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center) {
        Icon(icon, null, Modifier.size(26.dp), tint = if (enabled) colors.text else colors.faint)
        Text(label, Modifier.padding(top = 6.dp), color = if (enabled) colors.text else colors.faint)
    }
}

@Composable
private fun Composer(text: String, change: (String) -> Unit, savedMeals: List<JSONObject>, recent: List<JSONObject>, hasPhotos: Boolean,
    ready: Boolean, reuse: (JSONObject) -> Unit, send: () -> Unit) {
    val colors = NotedStyle.colors
    Column(Modifier.fillMaxWidth().background(colors.rail).padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp)) {
        val chips = savedMeals.take(6) + recent
        if (chips.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            items(chips, key = { "${it.text("id")}-${it.text("name")}" }) { meal ->
                PillChip(meal.text("name"), false, { reuse(meal) })
            }
        }
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(colors.input).border(1.dp, colors.border, RoundedCornerShape(24.dp))
            .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NotedTextField(text, change, Modifier.weight(1f), placeholder = { Text("What did you eat?") }, maxLines = 4, chrome = false)
            NotedFilledIconButton(send, Modifier.size(44.dp), enabled = ready && (text.isNotBlank() || hasPhotos)) {
                Icon(NotedIcons.ArrowUpward, "Estimate", Modifier.size(20.dp))
            }
        }
    }
}

private fun confidenceLabel(value: String) = when (value) { "high" -> "sure"; "low" -> "rough guess"; else -> "fairly sure" }

@Composable
private fun FoodRow(item: JSONObject, enabled: Boolean, edit: () -> Unit) {
    val colors = NotedStyle.colors
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(enabled = enabled, onClickLabel = "Change ${item.text("name")}", onClick = edit)
        .padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(item.text("name"), color = colors.text)
            Text(listOf(item.text("amount"), confidenceLabel(item.text("confidence"))).filter { it.isNotBlank() }.joinToString(" · "),
                color = colors.muted, fontSize = 13.sp)
        }
        Text("${item.text("kcal")}", color = colors.text, fontWeight = FontWeight.SemiBold)
    }
    HorizontalDivider(color = colors.subtle)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FollowUp(question: JSONObject, choose: (JSONObject) -> Unit, answer: (String) -> Unit, skip: () -> Unit) {
    val colors = NotedStyle.colors
    var own by remember(question) { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(vertical = 14.dp).clip(RoundedCornerShape(14.dp)).background(colors.floating)
        .border(1.dp, colors.subtle, RoundedCornerShape(14.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(question.text("text"), color = colors.text, fontWeight = FontWeight.Medium)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            question.rows("choices").forEach { choice -> PillChip(choice.text("label"), false, { choose(choice) }) }
            PillChip("Skip", false, skip)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NotedTextField(own, { own = it }, Modifier.weight(1f), placeholder = { Text("Or type your own answer") }, singleLine = true)
            NotedFilledIconButton({ answer(own.trim()) }, Modifier.size(40.dp), enabled = own.isNotBlank()) {
                Icon(NotedIcons.ArrowUpward, "Send answer", Modifier.size(18.dp))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FoodEditor(item: JSONObject, close: () -> Unit, remove: () -> Unit, change: (JSONObject) -> Unit) {
    var row by remember(item) { mutableStateOf(item.copy()) }
    fun set(key: String, value: String) { row = row.copy().put(key, value); change(row) }
    NotedSheet(close, title = "Change food") {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 16.dp).navigationBarsPadding().imePadding(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Field("Food", row.text("name"), { set("name", it) })
            Field("Portion", row.text("amount"), { set("amount", it) })
            Field("Calories", row.text("kcal"), { set("kcal", it) })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("protein" to "Protein, g", "carbs" to "Carbs, g", "fat" to "Fat, g").forEach { (key, label) ->
                    Field(label, row.text(key, "0"), { set(key, it) }, Modifier.weight(1f))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NotedOutlinedButton(remove, Modifier.weight(1f)) { Text("Remove food") }
                NotedButton(close, Modifier.weight(1f)) { Text("Done") }
            }
        }
    }
}
