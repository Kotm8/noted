package com.noted.android.features.channels

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.noted.android.data.NativeRepository
import com.noted.android.features.media.NativeImage
import com.noted.android.ui.*

@Composable
fun WorkspaceIconPicker(repository: NativeRepository, icon: String, image: Uri?, existingImage: String?,
    chooseIcon: (String) -> Unit, chooseImage: (Uri?) -> Unit) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(chooseImage) }
    val colors = NotedStyle.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Project icon", style = MaterialTheme.typography.labelLarge)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.size(64.dp).background(colors.selected, RoundedCornerShape(6.dp)), contentAlignment = Alignment.Center) {
                if (image != null) AsyncImage(model = image, contentDescription = "Selected project image", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds, imageLoader = repository.images())
                else if (!existingImage.isNullOrBlank()) NativeImage(repository, existingImage, "Project image", Modifier.fillMaxSize(), ContentScale.FillBounds)
                else Text(icon, style = MaterialTheme.typography.headlineLarge)
            }
            Column {
                NotedOutlinedButton({ picker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")) }) { Text("Import image or GIF") }
                if (image != null || !existingImage.isNullOrBlank()) NotedTextButton({ chooseImage(null) }) { Text("Remove image") }
            }
        }
        Text("Stretched to a square, then resized to 512 × 512. GIFs stay animated. Up to 5 MB.", style = MaterialTheme.typography.bodySmall, color = colors.muted)
        val icons = listOf("✦", "📚", "💻", "🌿", "☕", "🎨", "💡", "📝", "🏠", "🧠", "🎮", "🎵", "🎬", "📷", "🌙", "☀️", "🌻", "🍃", "🌊", "🔥", "🛠️", "🚀", "🧪", "🔭", "📦", "🗂️", "🔖", "📅", "🎯", "🏋️", "🍳", "🐈")
        BoxWithConstraints {
        val columns = (maxWidth / 36.dp).toInt().coerceIn(4, 8)
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        icons.chunked(columns).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            row.forEach { value -> Box(Modifier.size(34.dp).background(if (icon == value && image == null && existingImage.isNullOrBlank()) colors.selected else colors.main, RoundedCornerShape(4.dp))
                .border(1.dp, if (icon == value) colors.border else colors.main, RoundedCornerShape(4.dp))
                .clickable { chooseIcon(value) }.semantics { contentDescription = "Use $value as project icon"; selected = icon == value }, contentAlignment = Alignment.Center) { Text(value) } }
        } }
        }
        }
    }
}
