from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.repository import UserRepository
from app.auth.schemas import AppearancePreferences
from app.core.errors import AuthenticationError


class AppearanceService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)

    def read(self, user: User) -> AppearancePreferences | None:
        return AppearancePreferences.model_validate(user.appearance) if user.appearance else None

    def save(
        self, user: User, changes: AppearancePreferences, initialize: bool
    ) -> AppearancePreferences:
        locked = self.users.get_for_update(user.id)
        if locked is None:
            raise AuthenticationError("Sign in to continue")
        current = self.read(locked)
        if initialize and current is not None:
            return current
        values = (current or AppearancePreferences()).model_dump(by_alias=True)
        values.update(changes.model_dump(exclude_unset=True, by_alias=True))
        updated = AppearancePreferences.model_validate(values)
        locked.appearance = updated.model_dump(by_alias=True)
        self.db.commit()
        return updated
