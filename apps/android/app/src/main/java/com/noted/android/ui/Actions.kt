package com.noted.android.ui

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

val LocalSnackbar = staticCompositionLocalOf { SnackbarHostState() }

class Actions(private val scope: CoroutineScope, private val snackbar: SnackbarHostState) {
    var busy by mutableStateOf(false)
        private set
    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { block() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) { snackbar.showSnackbar(error.message ?: "Could not complete the action.") }
            finally { busy = false }
        }
    }
}

@Composable
fun rememberActions(): Actions {
    val scope = rememberCoroutineScope()
    val snackbar = LocalSnackbar.current
    return remember(scope, snackbar) { Actions(scope, snackbar) }
}
