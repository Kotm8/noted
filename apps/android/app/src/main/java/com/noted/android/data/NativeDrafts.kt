package com.noted.android.data

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.concurrent.ConcurrentHashMap

class NativeDrafts(private val local: LocalStore, private val session: StateFlow<NativeSession?>, scope: CoroutineScope) {
    private data class Value(val text: String, val generation: Long)
    private data class Write(val account: String, val path: String, val value: Value, val done: CompletableDeferred<Unit>? = null)
    private val writes = Channel<Write>(Channel.UNLIMITED)
    private val pending = ConcurrentHashMap<Pair<String, String>, Value>()
    private val generations = ConcurrentHashMap<String, Long>()
    val error = MutableStateFlow<String?>(null)

    init {
        scope.launch {
            for (write in writes) {
                try {
                    synchronized(local) {
                        if (session.value?.partition == write.account && (generations[write.account] ?: 0L) == write.value.generation) {
                            local.saveDraft(write.account, write.path, write.value.text)
                        }
                        pending.remove(write.account to write.path, write.value)
                    }
                    write.done?.complete(Unit)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    error.value = "Could not save this draft on your device. Keep Noted open and free some storage."
                    write.done?.completeExceptionally(failure)
                }
            }
        }
    }

    fun write(account: String, path: String, text: String) {
        if (session.value?.partition != account) return
        val value = Value(text, generations[account] ?: 0L)
        pending[account to path] = value
        check(writes.trySend(Write(account, path, value)).isSuccess)
    }

    suspend fun read(account: String, path: String): String = withContext(Dispatchers.IO) {
        synchronized(local) { pending[account to path]?.text ?: local.draft(account, path) }
    }

    suspend fun save(account: String, path: String, text: String) {
        val done = CompletableDeferred<Unit>()
        check(session.value?.partition == account) { "Sign in again before saving a draft." }
        val value = Value(text, generations[account] ?: 0L)
        pending[account to path] = value
        writes.send(Write(account, path, value, done))
        done.await()
    }

    fun clear(account: String) {
        generations.compute(account) { _, previous -> (previous ?: 0L) + 1 }
        pending.keys.removeAll { it.first == account }
    }
}
