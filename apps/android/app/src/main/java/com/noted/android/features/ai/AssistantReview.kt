package com.noted.android.features.ai

import com.noted.android.data.*
import org.json.JSONObject

val assistantGroups = listOf("plans", "habits", "meals", "rewrites", "posts", "deletions")

fun assistantSelection(proposal: JSONObject?): Set<String> = assistantGroups.flatMap { group ->
    proposal?.rows(group).orEmpty().indices.map { "$group-$it" }
}.toSet()

fun attachedContext(turns: List<JSONObject>): JSONObject? = turns.lastOrNull { it.optJSONObject("attached") != null }
    ?.getJSONObject("attached")?.let { attached -> json("channel_id" to attached.text("channel_id"),
        "message_ids" to attached.optJSONArray("message_ids"), "thread_root_id" to attached.opt("thread_root_id")) }

suspend fun currentAssistantMessage(repository: NativeRepository, context: JSONObject?, id: String): JSONObject {
    require(!context?.text("channel_id").isNullOrBlank()) { "Open this message from its channel before applying its rewrite." }
    val thread = context!!.text("thread_root_id").takeIf { it.isNotBlank() }
    val path = if (thread == null) "/channels/${context.text("channel_id")}/messages?around=$id" else "/messages/$thread/thread?around=$id"
    val response = JSONObject(repository.fetch(path))
    val page = if (thread == null) response else response.getJSONObject("replies")
    return (page.rows("items") + listOfNotNull(response.optJSONObject("root"))).firstOrNull { it.text("id") == id }
        ?: error("This message is no longer available. Your rewrite has not been applied.")
}

suspend fun applyAssistantRewrites(repository: NativeRepository, context: JSONObject?, changes: List<JSONObject>, originals: Map<String, String>) {
    changes.forEach { change ->
        val id = change.text("id")
        val before = originals[id] ?: error("Load the current message and review it before applying its rewrite.")
        val current = currentAssistantMessage(repository, context, id).text("content")
        val after = change.text("text")
        if (current != after) {
            check(current == before) { "This message changed since you reviewed it. Reopen it before applying the rewrite." }
            repository.mutate("/messages/$id", "PUT", json("content" to after, "expected_content" to before))
        }
    }
}
