from unittest.mock import patch

import pytest

from tests.browser_state import reset_browser_state


@pytest.mark.parametrize(
    ("schema", "options"),
    [
        ("public", "-csearch_path=public"),
        ("noted_browser_" + "a" * 32, "-csearch_path=public"),
        ("noted_browser_" + "a" * 32, "-csearch_path=noted_browser_" + "b" * 32),
    ],
)
def test_browser_reset_rejects_non_disposable_targets_before_connecting(
    schema: str, options: str
) -> None:
    from sqlalchemy.engine import URL

    target = URL.create("postgresql+psycopg", host="localhost", query={"options": options})
    with patch("tests.browser_state.create_database_engine") as connect:
        with pytest.raises(ValueError):
            reset_browser_state(target.render_as_string(hide_password=False), schema)
        connect.assert_not_called()
