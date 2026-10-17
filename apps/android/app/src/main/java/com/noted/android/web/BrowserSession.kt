package com.noted.android.web

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import com.google.androidbrowserhelper.trusted.TwaLauncher

class BrowserSession(activity: Activity) {
    private val launcher = TwaLauncher(activity)

    fun open(url: Uri, launched: () -> Unit) {
        val background = Color.rgb(31, 31, 31)
        val colors = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(background)
            .setNavigationBarColor(background)
            .setNavigationBarDividerColor(background)
            .build()
        val builder = TrustedWebActivityIntentBuilder(url).setDefaultColorSchemeParams(colors)
        launcher.launch(builder, CustomTabsCallback(), null, { launched() }, TwaLauncher.CCT_FALLBACK_STRATEGY)
    }

    fun close() { launcher.destroy() }
}
