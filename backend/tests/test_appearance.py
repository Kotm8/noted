from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import API, TEST_ORIGIN, TEST_PASSWORD


def test_reading_themes_validate_before_apply_and_sync(owner: TestClient) -> None:
    path = f"{API}/settings/appearance"
    theme = {
        "accent": "#123456",
        "density": "compact",
        "font": "serif",
        "codeFont": "courier",
        "lineHeight": 1.8,
        "readingWidth": 800,
        "reducedMotion": True,
        "highContrast": True,
    }
    validated = owner.post(f"{path}/validate", json=theme)
    assert validated.status_code == 200, validated.text
    assert owner.get(path).json() is None
    saved = owner.put(path, json={**theme, "savedThemes": {"Evening": theme}})
    assert saved.status_code == 200, saved.text
    assert owner.get(path).json()["savedThemes"]["Evening"]["density"] == "compact"
    assert (
        owner.post(f"{path}/validate", json={**theme, "password": "forbidden"}).status_code == 422
    )
    assert owner.put(path, json={"readingWidth": 1}).status_code == 422
    assert owner.get(path).json()["readingWidth"] == 800


def test_appearance_is_shared_between_sessions_and_partial_changes_merge(
    owner: TestClient, app: FastAPI
) -> None:
    path = f"{API}/settings/appearance"
    assert owner.get(path).json() is None
    initialized = owner.put(f"{path}?initialize=true", json={"accent": "#abcdef"})
    assert initialized.status_code == 200
    assert initialized.json()["messageLayout"] == "minute"
    assert initialized.json()["messageGroupMinutes"] == 2
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as other:
        assert (
            other.post(
                f"{API}/auth/login", json={"username": "ilya", "password": TEST_PASSWORD}
            ).status_code
            == 200
        )
        other.headers["X-CSRF-Token"] = other.cookies["noted_csrf"]
        assert other.get(path).json()["accent"] == "#abcdef"
        assert other.put(path, json={"messageLayout": "connected"}).status_code == 200
        assert other.put(path, json={"messageGroupMinutes": 5}).status_code == 200
        assert owner.put(path, json={"textSize": 17}).status_code == 200
        saved = other.get(path).json()
        assert saved["messageLayout"] == "connected"
        assert saved["messageGroupMinutes"] == 5
        assert saved["textSize"] == 17
        assert saved["accent"] == "#abcdef"
        assert other.put(f"{path}?initialize=true", json={"accent": "#000000"}).json() == saved


def test_appearance_validation_and_access(owner: TestClient, app: FastAPI) -> None:
    path = f"{API}/settings/appearance"
    for invalid in (
        {"accent": "url(javascript:bad)"},
        {"messageLayout": "unknown"},
        {"zoom": 1000},
        {"textSize": 1},
        {"textSize": True},
        {"messageGroupMinutes": 0},
        {"messageGroupMinutes": 31},
        {"messageGroupMinutes": 1.5},
        {"messageGroupMinutes": True},
        {"password": "no"},
        {"style": "neon"},
        {"mode": "dim"},
        {"colors": {"rail": "red"}},
        {"colors": {"danger": "#ffffff"}},
        {"profiles": {"snow-light": {"background": "red"}}},
        {"profiles": {"unknown-dark": {"text": "#ffffff"}}},
    ):
        assert owner.put(path, json=invalid).status_code == 422
    assert owner.put(path, json={}, headers={"X-CSRF-Token": ""}).status_code == 403
    with TestClient(app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}) as anonymous:
        assert anonymous.get(path).status_code == 401
        assert anonymous.put(path, json={}).status_code == 401


def test_palette_style_mode_and_colors_round_trip(owner: TestClient) -> None:
    path = f"{API}/settings/appearance"
    saved = owner.put(
        path,
        json={
            "style": "comic",
            "mode": "light",
            "colors": {"rail": "#eeeeee", "textMuted": "#555555"},
        },
    ).json()
    assert saved["style"] == "comic"
    assert saved["mode"] == "light"
    assert saved["colors"] == {"rail": "#eeeeee", "textMuted": "#555555"}
    assert saved["preset"] == "modern"
    assert saved["background"] == "#1f1f1f"
    assert owner.put(path, json={"textSize": 16}).json()["colors"]["rail"] == "#eeeeee"


def test_background_profiles_keep_each_modes_colors(owner: TestClient) -> None:
    path = f"{API}/settings/appearance"
    for style in ("modern", "comic", "snow", "stars"):
        for mode in ("dark", "light"):
            key = f"{style}-{mode}"
            response = owner.put(
                path,
                json={
                    "style": style,
                    "mode": mode,
                    "profiles": {key: {"background": "#123456", "headings": "#abcdef"}},
                },
            )
            assert response.status_code == 200
            assert response.json()["style"] == style
    profiles = owner.get(path).json()["profiles"]
    assert len(profiles) == 8
    assert profiles["snow-light"]["headings"] == "#abcdef"
    assert owner.put(path, json={"profiles": {}}).json()["profiles"] == {}


def test_concurrent_appearance_changes_do_not_overwrite_other_fields(
    owner: TestClient, app: FastAPI
) -> None:
    def save(changes: dict[str, str]) -> int:
        with TestClient(
            app, base_url="http://localhost", headers={"Origin": TEST_ORIGIN}
        ) as device:
            device.cookies.update(owner.cookies)
            device.headers["X-CSRF-Token"] = owner.cookies["noted_csrf"]
            return device.put(f"{API}/settings/appearance", json=changes).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [{"accent": "#abcdef"}, {"messageLayout": "connected"}]))
    assert results == [200, 200]
    saved = owner.get(f"{API}/settings/appearance").json()
    assert saved["accent"] == "#abcdef"
    assert saved["messageLayout"] == "connected"
