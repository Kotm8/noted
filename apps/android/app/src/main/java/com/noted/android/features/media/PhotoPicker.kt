package com.noted.android.features.media

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.noted.android.data.*
import com.noted.android.ui.*
import org.json.JSONObject

@Composable
fun PhotoPicker(repository: NativeRepository, ids: List<String>, enabled: Boolean = true, busy: (Boolean) -> Unit = {}, change: (List<String>) -> Unit) {
    val actions = rememberActions()
    val context = LocalContext.current
    val current by rememberUpdatedState(ids)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) actions.run {
            busy(true)
            try {
                val selected = current.toMutableList()
                for (uri in uris.take(4 - selected.size)) {
                    val photo = JSONObject(repository.api.uploadFile(context, "/nutrition/photos", uri, maxBytes = 25L * 1024 * 1024))
                    selected += photo.text("id"); change(selected.toList())
                }
            } finally { busy(false) }
        }
    }
    Column {
        if (ids.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(ids, key = { it }) { id -> Column(Modifier.width(110.dp)) {
                NativeImage(repository, "/api/v1/nutrition/photos/$id", "Attached photo", Modifier.size(110.dp))
                NotedTextButton({ change(current - id) }, enabled = enabled && !actions.busy) { Text("Remove photo") }
            } }
        }
        NotedOutlinedButton({ picker.launch(arrayOf("image/*")) }, enabled = enabled && !actions.busy && ids.size < 4) {
            Text(if (actions.busy) "Uploading photos…" else "Add photos")
        }
    }
}
