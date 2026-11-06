package com.noted.android.features.nutrition

import androidx.compose.material3.Text
import androidx.compose.runtime.*
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun NutritionProfile(repository: NativeRepository, existing: JSONObject?, close: () -> Unit) {
    var age by remember { mutableStateOf(existing?.optInt("age")?.toString().orEmpty()) }
    var height by remember { mutableStateOf(existing?.optDouble("height_cm")?.toString().orEmpty()) }
    var weight by remember { mutableStateOf(existing?.optDouble("weight_kg")?.toString().orEmpty()) }
    var sex by remember { mutableStateOf(existing?.text("sex") ?: "unspecified") }
    var activity by remember { mutableStateOf(existing?.text("activity") ?: "sedentary") }
    var pace by remember { mutableStateOf(existing?.text("pace") ?: "gentle") }
    var goal by remember { mutableStateOf(existing?.text("goal").orEmpty()) }
    var training by remember { mutableStateOf(existing?.optBoolean("read_training") ?: true) }
    var pregnant by remember { mutableStateOf(existing?.optBoolean("pregnant") ?: false) }
    val valid = age.toIntOrNull()?.let { it in 13..110 } == true && height.toDoubleOrNull()?.let { it in 100.0..250.0 } == true && weight.toDoubleOrNull()?.let { it in 30.0..300.0 } == true
    EditorSheet("Nutrition profile", close, enabled = valid, save = {
        repository.mutate("/nutrition/profile", "PUT", json("age" to age.toInt(), "height_cm" to height.toDouble(), "weight_kg" to weight.toDouble(),
            "sex" to sex, "activity" to activity, "pace" to pace, "goal" to goal, "read_training" to training, "pregnant" to pregnant))
    }) {
        Field("Age", age, { age = it })
        Choice("Sex, for the formula", sex, listOf("male" to "Male", "female" to "Female", "unspecified" to "Prefer not to say")) { sex = it }
        Field("Height, cm", height, { height = it }); Field("Weight, kg", weight, { weight = it })
        Choice("Activity", activity, listOf("sedentary" to "Mostly sitting", "light" to "Lightly active", "moderate" to "Moderately active", "very" to "Very active", "athlete" to "Athlete")) { activity = it }
        Choice("Pace", pace, listOf("gentle" to "Gentle", "standard" to "Standard")) { pace = it }
        Field("Your goal", goal, { goal = it.take(300) }, singleLine = false)
        Toggle("Use tracked time and habits for training context", training) { training = it }
        Toggle("Pregnant or breastfeeding", pregnant) { pregnant = it }
        Text("Your server calculates the target limits from this profile. You review any AI suggestion before saving it.")
    }
}
