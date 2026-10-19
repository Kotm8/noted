package com.noted.android.notifications

object PushIdentity {
    fun accepts(
        selectedOrigin: String?,
        savedOrigin: String,
        savedProject: String,
        savedSender: String,
        origin: String?,
        project: String?,
        sender: String?,
    ): Boolean =
        savedOrigin.isNotBlank() &&
            savedProject.isNotBlank() &&
            savedSender.isNotBlank() &&
            selectedOrigin == savedOrigin &&
            origin == savedOrigin &&
            project == savedProject &&
            sender == savedSender
}
