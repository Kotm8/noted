package com.noted.android.features.settings

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONObject
import java.time.LocalDate

@Composable
fun BackupSettings(repository: NativeRepository) {
    val context = LocalContext.current
    val actions = rememberActions()
    var backup by remember { mutableStateOf<JSONObject?>(null) }
    var imported by remember { mutableStateOf<JSONObject?>(null) }
    var mode by remember { mutableStateOf("merge") }
    var confirmation by remember { mutableStateOf("") }
    val destination = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        val item = backup
        if (uri != null && item != null) actions.run {
            withContext(Dispatchers.IO) {
                val api = repository.api
                api.transferClient.newCall(Request.Builder().url(api.url(item.text("download_url"))).build()).await().use { response ->
                    if (!response.isSuccessful) throw api.error(response)
                    context.contentResolver.openOutputStream(uri)?.use { output -> response.body!!.byteStream().use { it.copyTo(output, 65536) } }
                        ?: error("Could not open this destination.")
                }
            }
        }
    }
    val source = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) actions.run {
            val body = object : RequestBody() {
                override fun contentType() = "application/zip".toMediaType()
                override fun writeTo(sink: BufferedSink) {
                    context.contentResolver.openInputStream(uri)?.source()?.use { source ->
                        var total = 0L
                        while (true) {
                            val count = source.read(sink.buffer, 65536)
                            if (count < 0) break
                            total += count
                            require(total <= 1024L * 1024 * 1024) { "Backups must be at most 1 GB." }
                            sink.emitCompleteSegments()
                        }
                    } ?: error("Choose the ZIP file again.")
                }
            }
            imported = JSONObject(repository.api.send("/backups/preview", "POST", body, transfer = true))
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Backups", style = MaterialTheme.typography.titleLarge)
        Text("Download your notes and uploaded files as a ZIP. Credentials and server configuration are excluded.")
        NotedButton(enabled = !actions.busy, onClick = { actions.run {
            backup = JSONObject(repository.mutate("/backups/export"))
            destination.launch("noted-backup-${LocalDate.now()}.zip")
        } }, modifier = Modifier.fillMaxWidth()) { Text(if (actions.busy) "Working…" else "Download backup ZIP") }
        NotedOutlinedButton(enabled = !actions.busy, onClick = { source.launch(arrayOf("application/zip", "application/octet-stream")) }, modifier = Modifier.fillMaxWidth()) { Text("Choose backup ZIP") }
        imported?.let { preview ->
            SectionTitle("Import preview")
            preview.optJSONObject("counts")?.let { counts -> counts.keys().forEach { key ->
                if (counts.optInt(key) > 0) Text("${key.replace('_', ' ')}: ${counts.optInt(key)}")
            } }
            Choice("Import mode", mode, listOf("merge" to "Merge with existing content", "replace" to "Replace all existing content")) { mode = it }
            if (mode == "replace") {
                Text("This deletes existing content before restoring the backup.", color = MaterialTheme.colorScheme.error)
                Field("Type REPLACE MY NOTES", confirmation, { confirmation = it })
            }
            NotedButton(enabled = !actions.busy && (mode != "replace" || confirmation == "REPLACE MY NOTES"), onClick = { actions.run {
                repository.mutate("/backups/import", body = json("token" to preview.text("token"), "mode" to mode, "confirmation" to confirmation))
                imported = null
            } }, modifier = Modifier.fillMaxWidth()) { Text("Import backup") }
        }
    }
}
