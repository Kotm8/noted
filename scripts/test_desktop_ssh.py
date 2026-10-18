import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = """FROM debian:13-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server python3 iproute2 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /run/sshd /run/systemd/system && ssh-keygen -A && \
    printf 'root:noted-fixture-password\\n' | chpasswd
COPY sshd_config /etc/ssh/sshd_config
CMD ["/usr/sbin/sshd", "-D", "-e"]
"""
CONFIG = """Port 2222
ListenAddress 0.0.0.0
HostKey /etc/ssh/ssh_host_ed25519_key
PermitRootLogin yes
PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM no
PrintMotd no
PidFile /run/sshd.pid
"""


def docker(*arguments: str) -> str:
    return subprocess.check_output(["docker", *arguments], text=True).strip()


def main() -> None:
    name = f"noted-desktop-ssh-{uuid4().hex[:8]}"
    with tempfile.TemporaryDirectory(prefix="desktop-ssh-", dir=ROOT / ".local") as temporary:
        directory = Path(temporary)
        (directory / "Dockerfile").write_text(DOCKERFILE)
        (directory / "sshd_config").write_text(CONFIG)
        try:
            subprocess.run(["docker", "build", "-t", name, str(directory)], check=True)
            docker("run", "-d", "--name", name, "-p", "127.0.0.1::2222", name)
            inspection = json.loads(docker("inspect", name))[0]
            port = inspection["NetworkSettings"]["Ports"]["2222/tcp"][0]["HostPort"]
            key = docker("exec", name, "cat", "/etc/ssh/ssh_host_ed25519_key.pub")
            time.sleep(1)
            environment = {
                **os.environ,
                "NOTED_SSH_TEST_PORT": port,
                "NOTED_SSH_TEST_KEY": " ".join(key.split()[:2]),
            }
            subprocess.run(
                [
                    "cargo",
                    "test",
                    "--locked",
                    "--manifest-path",
                    str(ROOT / "apps/desktop/src-tauri/Cargo.toml"),
                    "ssh_round_trip_and_preflight",
                    "--",
                    "--ignored",
                    "--nocapture",
                ],
                env=environment,
                check=True,
            )
            if "--app" in sys.argv:
                docker("exec", name, "sh", "-c", f"printf '{'a' * 64}' > /opt/noted/.setup-id")
                test_app(directory, port)
                docker(
                    "exec",
                    name,
                    "sh",
                    "-c",
                    "test ! -e /opt/noted/.setup-id && test -f /opt/noted/existing-file",
                )
            print("PASS: SSH authentication, pinned keys, streaming, preflight, and safe cleanup.")
        finally:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)
            subprocess.run(["docker", "image", "rm", name], capture_output=True, check=False)


def test_app(directory: Path, ssh_port: str) -> None:
    executable = ROOT / "apps/desktop/src-tauri/target/debug/noted-desktop.exe"
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    environment = {
        **os.environ,
        "NOTED_DESKTOP_TEST_DIRECTORY": str(directory / "profile"),
        "NOTED_DESKTOP_DEBUG_PORT": str(port),
    }
    with (ROOT / ".local/desktop-setup.log").open("wb") as log:
        app = subprocess.Popen([str(executable)], env=environment, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                try:
                    with urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1):
                        break
                except (URLError, TimeoutError, ConnectionError):
                    time.sleep(0.25)
            else:
                raise RuntimeError("The native setup app did not start.")
            subprocess.run(
                ["node", "tests/setup.mjs", str(port), ssh_port, str(directory)],
                cwd=ROOT / "apps/desktop",
                check=True,
                timeout=120,
            )
        finally:
            app.terminate()
            app.wait(timeout=15)
            time.sleep(2)


if __name__ == "__main__":
    main()
