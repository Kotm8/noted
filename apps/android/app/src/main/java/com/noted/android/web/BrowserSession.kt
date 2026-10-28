package com.noted.android.web

import android.app.Activity
import android.graphics.Color
import android.net.Uri
import android.widget.ImageView
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.trusted.TrustedWebActivityIntentBuilder
import com.google.androidbrowserhelper.trusted.TwaLauncher
import com.google.androidbrowserhelper.trusted.splashscreens.PwaWrapperSplashScreenStrategy
import com.noted.android.R

class BrowserSession(activity: Activity) {
    private val launcher = TwaLauncher(activity)
    private val background = Color.rgb(31, 31, 31)

    /**
     * The browser keeps this logo up until the page first paints, so its own
     * window, and sometimes its address bar, isn't visible while Noted loads.
     */
    private val splash = PwaWrapperSplashScreenStrategy(
        activity, R.drawable.splash_logo, background, ImageView.ScaleType.CENTER,
        null, 200, "${activity.packageName}.splash", true,
    )

    fun open(url: Uri, launched: () -> Unit) {
        val colors = CustomTabColorSchemeParams.Builder()
            .setToolbarColor(background)
            .setNavigationBarColor(background)
            .setNavigationBarDividerColor(background)
            .build()
        val builder = TrustedWebActivityIntentBuilder(url).setDefaultColorSchemeParams(colors)
        launcher.launch(builder, CustomTabsCallback(), splash, { launched() }, TwaLauncher.CCT_FALLBACK_STRATEGY)
    }

    fun close() {
        splash.destroy()
        launcher.destroy()
    }
}
