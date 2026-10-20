package com.noted.wear

import android.app.Application
import com.noted.wear.data.WatchStore
import com.noted.wear.notifications.WatchPush
import com.noted.wear.notifications.WatchSyncWorker

class WatchApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (WatchStore(this).credentials() != null) {
            WatchSyncWorker.schedule(this)
            WatchPush.restore(this)
        } else {
            WatchStore(this).clear()
        }
    }
}
