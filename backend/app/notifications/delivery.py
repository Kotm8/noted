import logging
from importlib import import_module
from typing import Literal

from app.notifications.models import PushSubscription

logger = logging.getLogger(__name__)


def send_push(
    subscription: PushSubscription, private_key: str, origin: str, payload: str, *, ttl: int = 86400
) -> Literal["accepted", "expired", "failed"]:
    vapid = import_module("py_vapid")
    push = import_module("pywebpush")
    if subscription.endpoint.startswith("fcm:"):
        return "expired"
    try:
        push.webpush(
            subscription_info={"endpoint": subscription.endpoint, "keys": subscription.keys},
            data=payload,
            vapid_private_key=vapid.Vapid.from_pem(private_key.encode()),
            vapid_claims={"sub": origin},
            ttl=ttl,
            timeout=10,
        )
        return "accepted"
    except push.WebPushException as error:
        if error.response is not None and error.response.status_code in {404, 410}:
            return "expired"
    except (ValueError, OSError, vapid.VapidException):
        logger.warning("A push delivery failed")
    return "failed"
