import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]

DOCKERFILE = """FROM python:3.14.5-slim
RUN apt-get update && apt-get install -y --no-install-recommends \\
    openssh-server openssh-client python3 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /run/sshd && ssh-keygen -A && printf 'root:noted-fixture-password\\n' | chpasswd
COPY sshd_config /etc/ssh/sshd_config
COPY verify.py /verify.py
CMD ["/usr/sbin/sshd", "-D", "-e"]
"""

CONFIG = """Port 2222
ListenAddress 127.0.0.1
HostKey /etc/ssh/ssh_host_ed25519_key
PermitRootLogin yes
PasswordAuthentication yes
KbdInteractiveAuthentication no
UsePAM no
PrintMotd no
PidFile /run/sshd.pid
"""

VERIFY = """import base64, io, sys, tempfile, time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, '/updater')
from noted_updater.ssh import SSH
from noted_updater.docker import OperationError
key = ' '.join(Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[:2])
time.sleep(1)
with (
    tempfile.TemporaryDirectory() as directory,
    patch('noted_updater.ssh.public_ip', return_value='127.0.0.1'),
):
    connection = SSH(Path(directory), '127.0.0.1', 2222, key, 'noted-fixture-password')
    try:
        assert connection.run(['printf', 'verified']) == b'verified'
        command = ['python3', '-c', 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())']
        assert connection.run(command, input_file=io.BytesIO(b'private input')) == b'private input'
        with tempfile.TemporaryFile() as payload:
            payload.write(b'x' * 1048576)
            payload.seek(0)
            command = ['python3', '-c', 'import sys; print(len(sys.stdin.buffer.read()))']
            assert connection.run(command, input_file=payload).strip() == b'1048576'
    finally:
        connection.close()
    assert not connection.password.exists()
    raw = b'\\0\\0\\0\\x0bssh-ed25519\\0\\0\\0\\x20' + b'x' * 32
    wrong = 'ssh-ed25519 ' + base64.b64encode(raw).decode()
    connection = SSH(Path(directory), '127.0.0.1', 2222, wrong, 'noted-fixture-password')
    try:
        try:
            connection.run(['printf', 'must not run'])
            raise AssertionError('A changed host key was accepted')
        except OperationError:
            pass
    finally:
        connection.close()
print('PASS: verified SSH authentication, streamed input, host-key rejection, and secret cleanup.')
"""


def main() -> None:
    name = f"noted-ssh-test-{uuid4().hex[:8]}"
    directory_root = ROOT / ".local"
    directory_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ssh-test-", dir=directory_root) as temporary:
        directory = Path(temporary)
        (directory / "Dockerfile").write_text(DOCKERFILE)
        (directory / "sshd_config").write_text(CONFIG)
        (directory / "verify.py").write_text(VERIFY)
        try:
            result = subprocess.run(
                ["docker", "build", "-t", name, str(directory)],
                capture_output=True,
                timeout=600,
                check=False,
            )
            if result.returncode:
                (directory_root / "ssh-build.log").write_bytes(result.stderr)
                raise RuntimeError("SSH fixture image did not build. See .local/ssh-build.log.")
            subprocess.run(
                [
                    "docker",
                    "run",
                    "-d",
                    "--name",
                    name,
                    "--network",
                    "none",
                    "--mount",
                    f"type=bind,source={ROOT / 'updater'},target=/updater,readonly",
                    name,
                ],
                check=True,
                capture_output=True,
            )
            subprocess.run(["docker", "exec", name, "python", "/verify.py"], check=True)
        finally:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True, check=False)
            subprocess.run(["docker", "image", "rm", name], capture_output=True, check=False)


if __name__ == "__main__":
    main()
