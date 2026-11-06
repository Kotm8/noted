package com.noted.android.features.auth

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.noted.android.R
import com.noted.android.connection.ConnectionStore
import com.noted.android.data.NativeRepository
import com.noted.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(repository: NativeRepository) {
    val context = LocalContext.current
    var server by rememberSaveable { mutableStateOf(ConnectionStore(context).origin.orEmpty()) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val submit = {
        if (!busy && server.isNotBlank() && username.isNotBlank() && password.isNotBlank()) {
            busy = true; error = null
            scope.launch {
                try { repository.login(server, username, password); password = "" }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { error = failure.message ?: "Could not sign in." }
                finally { busy = false }
            }
        }
    }
    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState())
        .padding(horizontal = 28.dp, vertical = 48.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Image(painterResource(R.drawable.ic_brand), "Noted", Modifier.size(56.dp).align(Alignment.Start))
        Spacer(Modifier.height(16.dp))
        Text("Sign in to Noted", style = MaterialTheme.typography.headlineSmall)
        Text("Sign in to your Noted server.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Field("Server address", server, { server = it })
        Field("Username", username, { username = it })
        NotedTextField(password, { password = it }, Modifier.fillMaxWidth(), label = { Text("Password") }, fieldLabel = "Password",
            visualTransformation = PasswordVisualTransformation(), singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submit() }))
        error?.let { QuietNotice(it, true) }
        NotedButton(onClick = submit, enabled = !busy && server.isNotBlank() && username.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(38.dp)) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Sign in")
        }
        Text("Use the account you created in the desktop installer.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
