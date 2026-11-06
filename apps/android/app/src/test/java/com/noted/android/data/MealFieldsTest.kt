package com.noted.android.data

import com.noted.android.features.nutrition.*
import org.junit.Assert.*
import org.junit.Test

class MealFieldsTest {
    @Test fun decimalsStayNumericWhenSaving() {
        val saved = mealItems(listOf(json("name" to "Oats", "kcal" to "150", "protein" to "1.5", "carbs" to "20.25", "fat" to "0"))).getJSONObject(0)
        assertEquals(150, saved.getInt("kcal"))
        assertEquals(1.5, saved.getDouble("protein"), .001)
        assertTrue(saved.get("protein") is Number)
    }

    @Test fun incompleteAndNonfiniteNumbersCannotBeSaved() {
        val valid = json("name" to "Oats", "kcal" to "150", "protein" to "1.5")
        for ((key, value) in listOf("kcal" to "", "kcal" to "1.5", "kcal" to "6001", "protein" to "NaN", "fat" to "-1")) {
            assertFalse(validMealItems(listOf(valid.copy().put(key, value))))
        }
    }
}
