package com.noted.android.features.nutrition

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SavedMeals(meals: List<JSONObject>, close: () -> Unit, edit: (JSONObject) -> Unit) {
    NotedSheet(close, title = "Saved meals") {
        LazyColumn(Modifier.fillMaxWidth().fillMaxHeight(.8f), contentPadding = PaddingValues(16.dp)) {
            items(meals, key = { it.text("id") }) { meal ->
                NotedListItem(headlineContent = { Text(meal.text("name")) }, supportingContent = {
                    Text("${meal.rows("items").sumOf { it.optInt("kcal") }} kcal · ${meal.rows("items").size} foods")
                }, trailingContent = { Icon(NotedIcons.Edit, null) }, modifier = Modifier.clickable { edit(meal) })
            }
            item { NotedOutlinedButton({ edit(JSONObject()) }, Modifier.fillMaxWidth()) { Text("New saved meal") } }
        }
    }
}
