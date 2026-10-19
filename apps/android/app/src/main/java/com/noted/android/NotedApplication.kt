package com.noted.android

import android.app.Application
import com.noted.android.notifications.FirebaseRuntime

class NotedApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        FirebaseRuntime.restore(this)
    }
}
