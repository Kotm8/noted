import argparse
import os
import re
import subprocess
import sys

BACKEND_SMOKE = (
    "tests/test_auth.py",
    "tests/test_owner_provisioning.py",
    "tests/test_sessions.py",
    "tests/test_notes.py",
    "tests/test_backups.py",
    "tests/test_push_isolation.py",
    "tests/test_plan_end_prompts.py",
)

BROWSER_SMOKE = (
    "portable ZIP export and previewed import",
    "the owner can organize, write, edit, and delete persistent notes",
    "Notes channels autosave Markdown",
    "reminders persist, support keyboard scheduling",
    "server updates require an explicit install",
    "channel clicks preserve the current page and draft",
    "Android startup keeps the drawn logo",
    "ended activity opens on Android",
)


def browser_arguments(arguments: list[str]) -> list[str]:
    if "--full" in arguments:
        return [value for value in arguments if value != "--full"]
    if arguments or os.environ.get("NOTED_FULL_TESTS") == "1":
        return arguments
    return ["--grep", "|".join(re.escape(value) for value in BROWSER_SMOKE)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run core backend checks or the full suite.")
    parser.add_argument("--full", action="store_true")
    args, extra = parser.parse_known_args()
    full = args.full or os.environ.get("NOTED_FULL_TESTS") == "1"
    targeted = any(not value.startswith("-") for value in extra)
    selected = [] if full or targeted else list(BACKEND_SMOKE)
    return subprocess.run([sys.executable, "-m", "pytest", "-q", *selected, *extra]).returncode


if __name__ == "__main__":
    sys.exit(main())
