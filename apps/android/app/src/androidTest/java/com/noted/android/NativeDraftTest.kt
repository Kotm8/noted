package com.noted.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.noted.android.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeDraftTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun rapidEditsRemainReadableAndPersistInOrderOutsideTheScreenScope() = runBlocking {
        val local = LocalStore(context)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val session = MutableStateFlow<NativeSession?>(NativeSession("https://draft.example", UUID.randomUUID().toString(), "native", emptyList()))
        val account = session.value!!.partition
        val drafts = NativeDrafts(local, session, scope)
        try {
            repeat(100) { drafts.write(account, "/draft", "Draft $it") }
            assertEquals("Draft 99", drafts.read(account, "/draft"))
            drafts.save(account, "/draft", "Final draft")
            assertEquals("Final draft", local.draft(account, "/draft"))
        } finally { scope.coroutineContext[Job]!!.cancelAndJoin(); local.clear(account); local.close() }
    }

    @Test fun queuedWritesCannotRestoreClearedDataAfterSigningBackIntoTheSameAccount() = runBlocking {
        val local = LocalStore(context)
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val owner = NativeSession("https://draft.example", UUID.randomUUID().toString(), "native", emptyList())
        val session = MutableStateFlow<NativeSession?>(owner)
        val drafts = NativeDrafts(local, session, scope)
        try {
            synchronized(local) {
                repeat(30) { drafts.write(owner.partition, "/old", "Old private draft $it") }
                session.value = null
                local.clear(owner.partition); drafts.clear(owner.partition)
                drafts.write(owner.partition, "/old", "Late screen disposal")
                session.value = owner
            }
            drafts.save(owner.partition, "/barrier", "Signed in again")
            assertEquals("", local.draft(owner.partition, "/old"))
            assertEquals("", drafts.read(owner.partition, "/old"))
        } finally { scope.coroutineContext[Job]!!.cancelAndJoin(); local.clear(owner.partition); local.close() }
    }
}
