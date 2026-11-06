package com.noted.android

import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.*
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

@RunWith(AndroidJUnit4::class)
class NativeMediaTest {
    @get:Rule val compose = createEmptyComposeRule()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val repository get() = (context.applicationContext as NotedApplication).repository

    private fun signIn() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("nativeParity") == "true")
        runBlocking { repository.logout(); repository.login("http://localhost:8123", "native", "native-test-password-only") }
    }

    @Test fun gifPreviewAnimatesAndVideoPlaysWithoutABrowser() {
        signIn()
        val channel = runBlocking { JSONArray(repository.api.request("/channels")).objects().first { it.text("name") == "media" } }
        val launch = Intent(context, MainActivity::class.java).setData(Uri.parse("http://localhost:8123/channels/${channel.text("id")}"))
        ActivityScenario.launch<MainActivity>(launch).use {
            compose.waitUntil(15_000) { compose.onAllNodesWithContentDescription("native-animation.gif").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("native-animation.gif").performScrollTo()
            val seen = mutableSetOf<String>()
            compose.waitUntil(5_000) {
                val center = compose.onNodeWithContentDescription("native-animation.gif").fetchSemanticsNode().boundsInRoot.center
                val image = instrumentation.uiAutomation.takeScreenshot()
                val pixel = image.getPixel(center.x.toInt(), center.y.toInt())
                image.recycle()
                if (Color.red(pixel) > 140 && Color.blue(pixel) < 130) seen += "red"
                if (Color.blue(pixel) > 140 && Color.red(pixel) < 130) seen += "blue"
                seen.size == 2
            }
            compose.onNodeWithContentDescription("native-animation.gif").performClick()
            compose.onNodeWithContentDescription("Close viewer").assertIsDisplayed().performClick()
            compose.onNodeWithText("native-video.mp4").performScrollTo().performClick()
            compose.onNodeWithContentDescription("Play video").performClick()
            compose.waitUntil(10_000) { compose.onAllNodesWithContentDescription("Pause video").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithContentDescription("Close viewer").performClick()
        }
    }

    @Test fun imageAndGifProjectIconsUploadAndCanBeRemoved() {
        signIn()
        runBlocking {
            val project = JSONArray(repository.api.request("/workspaces")).objects().first()
            val path = "/workspaces/${project.text("id")}/icon"
            val bitmap = Bitmap.createBitmap(96, 48, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.YELLOW) }
            val png = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
            bitmap.recycle()
            val media = JSONArray(repository.api.request("/channels")).objects().first { it.text("name") == "media" }
            val gif = JSONObject(repository.api.request("/channels/${media.text("id")}/messages")).rows("items")
                .flatMap { it.rows("attachments") }.first { it.text("original_filename").endsWith(".gif") }
            val gifBytes = repository.api.client.newCall(Request.Builder().url(repository.api.url(gif.text("download_url"))).build()).execute().use { it.body!!.bytes() }
            try {
                for ((mime, bytes) in listOf("image/png" to png, "image/gif" to gifBytes)) {
                    val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, "noted-native-test.${mime.substringAfter('/')}")
                        put(MediaStore.Images.Media.MIME_TYPE, mime)
                    })!!
                    try {
                        context.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                        val saved = JSONObject(repository.api.uploadFile(context, path, uri, "PUT"))
                        assertTrue(saved.text("icon_url").isNotBlank())
                        repository.api.client.newCall(Request.Builder().url(repository.api.url(saved.text("icon_url"))).build()).execute().use { response ->
                            assertEquals(200, response.code)
                            val drawable = android.graphics.ImageDecoder.decodeDrawable(android.graphics.ImageDecoder.createSource(java.nio.ByteBuffer.wrap(response.body!!.bytes())))
                            assertEquals(512, drawable.intrinsicWidth)
                            assertEquals(512, drawable.intrinsicHeight)
                            if (mime == "image/gif") assertTrue(drawable is android.graphics.drawable.AnimatedImageDrawable)
                        }
                    } finally { context.contentResolver.delete(uri, null, null) }
                }
            } finally { repository.mutate(path, "DELETE") }
            val cleared = JSONArray(repository.api.request("/workspaces")).objects().first { it.text("id") == project.text("id") }
            assertTrue(cleared.text("icon_url").isBlank())
        }
    }
}
