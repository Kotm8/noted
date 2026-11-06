package com.noted.android

import android.app.Application
import com.noted.android.notifications.FirebaseRuntime
import com.noted.android.data.NativeRepository

class NotedApplication : Application() {
    val repository by lazy { NativeRepository(this) }
    override fun onCreate() {
        super.onCreate()
        FirebaseRuntime.restore(this)
    }
}
