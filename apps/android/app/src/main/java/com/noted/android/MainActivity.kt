package com.noted.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebViewClient
import com.getcapacitor.CapConfig
import com.getcapacitor.Plugin
import com.getcapacitor.annotation.CapacitorPlugin
import com.noted.android.pilot.PilotPlugin
import com.noted.android.pilot.PilotTracker
import java.io.ByteArrayInputStream
import kotlinx.coroutines.launch

class MainActivity : BridgeActivity() {
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        (bridge?.getPlugin("NotedPilot")?.instance as? PilotPlugin)?.openIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        com.noted.android.notifications.NotificationSyncWorker.enqueue(this)
        lifecycleScope.launch { runCatching { PilotTracker.sync(this@MainActivity) } }
    }

    override fun onCreate(state: Bundle?) {
        config = CapConfig.Builder(this)
            .setHostname(LOCAL_HOST)
            .setAndroidScheme("https")
            .setBackgroundColor("#1f1f1f")
            .setLoggingEnabled(false)
            .setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
            .create()
        registerPlugin(PilotPlugin::class.java)
        registerPlugin(DisabledHttp::class.java)
        registerPlugin(DisabledCookies::class.java)
        registerPlugin(DisabledWebView::class.java)
        super.onCreate(state)
        val web = bridge?.webView ?: return
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowCompat.getInsetsController(window, web)
        insetsController.isAppearanceLightStatusBars = false
        var keyboardVisible = false
        ViewCompat.setOnApplyWindowInsetsListener(web) { view, insets ->
            val imeVisible = insets.isVisible(WindowInsetsCompat.Type.ime())
            if (keyboardVisible && !imeVisible) {
                web.evaluateJavascript("window.dispatchEvent(new Event('noted:keyboard-hidden'))", null)
            }
            keyboardVisible = imeVisible
            val padding = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(padding.left, padding.top, padding.right, padding.bottom)
            WindowInsetsCompat.CONSUMED
        }
        ViewCompat.requestApplyInsets(web)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (keyboardVisible) {
                    insetsController.hide(WindowInsetsCompat.Type.ime())
                    return
                }
                web.evaluateJavascript(
                    "window.dispatchEvent(new Event('noted:android-back', {cancelable: true}))",
                ) { unhandled ->
                    if (unhandled != "false" && !isFinishing) {
                        if (web.canGoBack()) web.goBack() else finish()
                    }
                }
            }
        })
    }

    override fun load() {
        super.load()
        val web = bridge.webView
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.javaScriptCanOpenWindowsAutomatically = false
        web.settings.setSupportMultipleWindows(false)
        bridge.setWebViewClient(object : BridgeWebViewClient(bridge) {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) =
                !request.isForMainFrame || !local(request.url)

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (local(request.url)) {
                    if (request.url.encodedPath?.startsWith("/incoming/") == true) {
                        if (request.method == "GET" && !request.isForMainFrame && request.url.encodedQuery == null &&
                            request.url.encodedPath == "/incoming/${request.url.lastPathSegment}"
                        ) {
                            val plugin = bridge.getPlugin("NotedPilot")?.instance as? PilotPlugin
                            plugin?.incomingPhoto(request.url.lastPathSegment)?.let { return it }
                        }
                        return WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                            emptyMap(), ByteArrayInputStream(ByteArray(0)))
                    }
                    if (request.url.path?.startsWith("/api/") != true)
                        return super.shouldInterceptRequest(view, request)
                    if (request.method == "GET" && !request.isForMainFrame &&
                        request.url.encodedFragment == null
                    ) {
                        val plugin = bridge.getPlugin("NotedPilot")?.instance as? PilotPlugin
                        val range = request.requestHeaders.entries.firstOrNull { it.key.equals("Range", ignoreCase = true) }?.value
                        plugin?.media(request.url.encodedPath.orEmpty(), request.url.encodedQuery, range)?.let { return it }
                    }
                }
                return WebResourceResponse(
                    "text/plain", "UTF-8", 403, "Forbidden", emptyMap(),
                    ByteArrayInputStream(ByteArray(0)),
                )
            }
        })
    }

    private fun local(uri: Uri) =
        uri.scheme == "https" && uri.host == LOCAL_HOST && uri.port == -1 && uri.userInfo == null

    companion object {
        private const val LOCAL_HOST = "noted.localhost"
    }
}

class PhoneCameraProvider : FileProvider()

@CapacitorPlugin(name = "CapacitorHttp")
class DisabledHttp : Plugin()

@CapacitorPlugin(name = "CapacitorCookies")
class DisabledCookies : Plugin()

@CapacitorPlugin(name = "WebView")
class DisabledWebView : Plugin()
