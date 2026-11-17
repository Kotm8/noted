import os
import subprocess
import sys
import tempfile
from pathlib import Path

if os.environ.get("NOTED_COMPOSE_FIXTURE") != "1" or not Path("/.dockerenv").exists():
    raise RuntimeError("Run this fixture through scripts/test_compose_install.py")

folder = Path(tempfile.mkdtemp())
bin_directory = folder / "bin"
bin_directory.mkdir()
tools = {
    "docker": """#!/bin/sh
if test -f "$TEST_READY" || test -f /usr/local/lib/docker/cli-plugins/docker-compose; then
    exit 0
fi
exit 1
""",
    "apt-get": """#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_TRACE"
case "$*" in
    *docker-compose-plugin*)
        test "$APT_WORKS" = 1 || exit 1
        touch "$TEST_READY"
        ;;
esac
""",
    "curl": """#!/bin/sh
test "$DOWNLOAD_WORKS" = 1 || exit 22
while test "$1" != -o; do shift; done
shift
case "$1" in
    *.sha256)
        if test "$BAD_HASH" = 1; then
            printf '%064d  docker-compose-linux-x86_64\\n' 0 > "$1"
        else
            (cd "$(dirname "$1")"; /usr/bin/sha256sum docker-compose-linux-x86_64) > "$1"
        fi
        ;;
    *) printf '#!/bin/sh\\nexit 0\\n' > "$1" ;;
esac
""",
}
for name, text in tools.items():
    path = bin_directory / name
    path.write_text(text)
    path.chmod(0o755)
helper = sys.stdin.read()
target = Path("/usr/local/lib/docker/cli-plugins/docker-compose")
cases = [
    ("working", True, 0, 0, 0, 0),
    ("apt-repair", False, 1, 0, 0, 0),
    ("verified-download", False, 0, 1, 0, 0),
    ("reject-altered-download", False, 0, 1, 1, 37),
    ("download-failure", False, 0, 0, 0, 37),
]
for name, ready, apt, download, bad, expected in cases:
    target.unlink(missing_ok=True)
    flag = folder / "ready"
    flag.unlink(missing_ok=True)
    trace = folder / "trace"
    trace.unlink(missing_ok=True)
    if ready:
        flag.touch()
    environment = {
        **os.environ,
        "PATH": str(bin_directory) + ":/usr/bin:/bin",
        "TEST_READY": str(flag),
        "TEST_TRACE": str(trace),
        "APT_WORKS": str(apt),
        "DOWNLOAD_WORKS": str(download),
        "BAD_HASH": str(bad),
    }
    result = subprocess.run(
        ["sh", "-c", helper + "\nensure_compose"],
        env=environment,
        capture_output=True,
        text=True,
    )
    assert result.returncode == expected, (name, result.returncode, result.stderr)
    if ready:
        assert not trace.exists()
    else:
        text = trace.read_text()
        assert "--no-remove --no-upgrade" in text
        assert "docker-ce " not in text and "containerd" not in text
    if expected:
        assert not target.exists()
    print(name, "PASS", flush=True)
