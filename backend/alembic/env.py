from sqlalchemy.engine import Connection

from alembic import context
from app.core.config import Settings
from app.db.database import create_database_engine
from app.db.models import Base


def run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


supplied_connection = context.config.attributes.get("connection")

if isinstance(supplied_connection, Connection):
    run_migrations(supplied_connection)
else:
    engine = create_database_engine(Settings().database_url)
    with engine.connect() as connection:
        run_migrations(connection)
    engine.dispose()
