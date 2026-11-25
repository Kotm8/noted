from typing import Literal

from app.core.config import Settings
from app.notifications.firebase import send_firebase
from app.notifications.models import PushSubscription


def send_push(
    subscription: PushSubscription,
    origin: str,
    payload: str,
    *,
    ttl: int = 86400,
    settings: Settings | None = None,
    urgent: bool = True,
    collapse_key: str | None = None,
) -> Literal["accepted", "expired", "failed"]:
    if not subscription.endpoint.startswith("fcm:"):
        return "expired"
    if settings is None:
        return "failed"
    return send_firebase(
        subscription.endpoint,
        settings.storage_path,
        origin,
        payload,
        ttl,
        urgent=urgent,
        collapse_key=collapse_key,
        package_name="com.noted.android.pilot"
        if subscription.keys.get("package_name") == "com.noted.android.pilot"
        else "com.noted.android",
    )
