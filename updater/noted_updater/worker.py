import contextlib
import os
import shutil
import threading
import time
from pathlib import Path

from .config import Config
from .engine import Engine
from .files import now, read_json, write_json
from .github import GitHubSource
from .host import Host


@contextlib.contextmanager
def process_lock(path: Path):
    with path.open("a+b") as file:
        if os.name == "nt":
            import msvcrt

            if file.tell() == 0:
                file.write(b"0")
                file.flush()
            file.seek(0)
            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == "nt":
                file.seek(0)
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(file.fileno(), fcntl.LOCK_UN)


class Worker:
    def __init__(self, config: Config):
        self.config = config
        token = config.token_file.read_text().strip() if config.token_file else None
        self.engine = Engine(config, GitHubSource(config.repository, token))
        self.host = Host(config, self.engine)
        self.stop = threading.Event()

    def heartbeat(self) -> None:
        while not self.stop.is_set():
            write_json(self.config.state / "heartbeat.json", {"at": now()}, 0o644)
            self.stop.wait(10)

    def run(self) -> None:
        with process_lock(self.config.control / "worker.lock"):
            thread = threading.Thread(target=self.heartbeat, daemon=True)
            thread.start()
            try:
                self.engine.interrupted()
                self.host.engine = self.engine
                self.host.docker = self.engine.docker
                self.host.interrupted()
                service_path = self.config.state / "service.json"
                service = read_json(service_path)
                service["capabilities"] = (
                    ["host-admin-v1"]
                    if os.name != "nt" and shutil.which("ssh") and shutil.which("ssh-keyscan")
                    else []
                )
                write_json(service_path, service, 0o644)
                next_check = 0.0
                while not self.stop.is_set():
                    host_request = self.config.requests / "host.json"
                    if host_request.exists():
                        request = None
                        try:
                            request = read_json(host_request, 16384)
                            if self.host.apply(request):
                                self.stop.set()
                                thread.join(timeout=12)
                                self.host.remove(request.get("confirmation", ""))
                                return
                        finally:
                            if isinstance(request, dict):
                                request.clear()
                            host_request.unlink(missing_ok=True)
                    self.host.poll_transfer()
                    if self.host.busy() or self.config.maintenance.exists():
                        self.stop.wait(5)
                        continue
                    check = self.config.requests / "check.json"
                    apply = self.config.requests / "apply.json"
                    if check.exists() or time.monotonic() >= next_check:
                        check.unlink(missing_ok=True)
                        try:
                            release = self.engine.check()
                            self.engine.download_available(release)
                        except Exception:
                            pass
                        next_check = time.monotonic() + self.config.check_seconds
                    if apply.exists():
                        try:
                            request = read_json(apply, 4096)
                            job_path = self.config.state / "job.json"
                            previous = read_json(job_path) if job_path.exists() else {}
                            if previous.get("status") == "needs_recovery":
                                pass
                            elif previous.get("id") != request.get("id"):
                                self.engine.apply(request)
                        finally:
                            apply.unlink(missing_ok=True)
                    self.stop.wait(2)
            finally:
                self.stop.set()
                thread.join(timeout=12)
