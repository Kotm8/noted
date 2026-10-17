import base64
import hashlib
import io
import ipaddress
import os
import shlex
import subprocess
from pathlib import Path
from typing import BinaryIO

from .docker import OperationError
from .files import write_file


def public_ip(value: str) -> str:
    address = ipaddress.ip_address(value)
    if not address.is_global:
        raise OperationError("Use the public IP of a different VPS.")
    return str(address)


def fingerprint(key: str) -> str:
    kind, encoded = key.split(" ")
    raw = base64.b64decode(encoded, validate=True)
    if (
        kind != "ssh-ed25519"
        or len(raw) != 51
        or raw[:19] != b"\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20"
    ):
        raise OperationError("Choose a valid Ed25519 SSH host key.")
    return "SHA256:" + base64.b64encode(hashlib.sha256(raw).digest()).decode().rstrip("=")


def probe(ip: str, port: int) -> tuple[str, str]:
    address = public_ip(ip)
    if not 1 <= port <= 65535:
        raise OperationError("Invalid SSH port.")
    try:
        result = subprocess.run(
            ["ssh-keyscan", "-T", "10", "-p", str(port), "-t", "ed25519", address],
            capture_output=True,
            timeout=20,
            check=False,
        )
        lines = result.stdout.decode().splitlines()
        keys = {
            " ".join(line.split()[1:3])
            for line in lines
            if line and not line.startswith("#") and len(line.split()) == 3
        }
        if len(keys) != 1:
            raise ValueError
        key = keys.pop()
        return key, fingerprint(key)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise OperationError("Could not read the destination SSH host key.") from None


class SSH:
    def __init__(self, directory: Path, ip: str, port: int, key: str, password: str):
        self.ip = public_ip(ip)
        fingerprint(key)
        if not 1 <= port <= 65535 or not password or len(password) > 1024:
            raise OperationError("Invalid SSH connection details.")
        self.directory = directory
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.password = directory / "password"
        self.hosts = directory / "known_hosts"
        self.askpass = directory / "askpass"
        try:
            write_file(self.password, password.encode())
            host = self.ip if port == 22 else f"[{self.ip}]:{port}"
            write_file(self.hosts, f"{host} {key}\n".encode())
            write_file(
                self.askpass,
                b"#!/usr/bin/python3\nimport os, pathlib\n"
                b"print(pathlib.Path(os.environ['NOTED_SSH_PASSWORD_FILE']).read_text(), end='')\n",
                0o700,
            )
        except BaseException:
            self.close()
            raise
        self.arguments = [
            "ssh",
            "-F",
            "/dev/null",
            "-T",
            "-p",
            str(port),
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "HostKeyAlgorithms=ssh-ed25519",
            "-o",
            f"UserKnownHostsFile={self.hosts}",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "ConnectTimeout=15",
            "-o",
            "NumberOfPasswordPrompts=1",
            "-o",
            "PreferredAuthentications=password",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "KbdInteractiveAuthentication=no",
            "-o",
            "ForwardAgent=no",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=4",
            "-l",
            "root",
            self.ip,
        ]

    def run(
        self, arguments: list[str], *, input_file: BinaryIO | None = None, timeout: int = 300
    ) -> bytes:
        environment = {
            **os.environ,
            "SSH_ASKPASS": str(self.askpass),
            "SSH_ASKPASS_REQUIRE": "force",
            "DISPLAY": "noted:0",
            "NOTED_SSH_PASSWORD_FILE": str(self.password),
        }
        try:
            payload = input_file.getvalue() if isinstance(input_file, io.BytesIO) else None
            result = subprocess.run(
                [*self.arguments, shlex.join(arguments)],
                stdin=None if payload is not None else input_file or subprocess.DEVNULL,
                input=payload,
                capture_output=True,
                env=environment,
                start_new_session=True,
                timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            raise OperationError(
                "SSH did not complete. Check the destination and its SSH access."
            ) from None
        if result.returncode:
            raise OperationError(
                "The remote step failed. Verify the host key, root password, "
                "and destination prerequisites."
            )
        return result.stdout

    def close(self) -> None:
        self.password.unlink(missing_ok=True)
        self.askpass.unlink(missing_ok=True)
