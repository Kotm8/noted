package com.noted.android.ui

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.noted.android.MainActivity

/**
 * Opens a page of the owner's server in the browser. The app claims https links itself, so the page goes
 * to the default browser by package, or through a chooser that leaves this app out.
 */
fun openOnWeb(context: Context, origin: String, path: String) {
    val uri = Uri.parse(origin.trimEnd('/') + path)
    val view = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val browser = context.packageManager.resolveActivity(Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER), 0)
        ?.activityInfo?.packageName?.takeIf { it != "android" && it != context.packageName }
    if (browser != null) {
        try { context.startActivity(Intent(view).setPackage(browser)); return }
        catch (_: ActivityNotFoundException) { }
    }
    context.startActivity(Intent.createChooser(view, "Open in browser").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, arrayOf(ComponentName(context, MainActivity::class.java))))
}
