#!/usr/bin/env python3
"""Prepare dummy fixtures, then run real Vite inside a bounded offline container."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "artifacts/security-vite"
IMAGE = "node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5"
PACKAGES = ("@rollup/rollup-linux-arm64-gnu", "@esbuild/linux-arm64")


def copy_source(scratch):
    source = scratch / "source"
    source.mkdir()
    for name in ("demo",):
        if any(path.is_symlink() for path in (ROOT / name).rglob("*")):
            raise RuntimeError(f"Source symlink requires review: {name}")
        shutil.copytree(ROOT / name, source / name)
    for name in ("package.json", "tsconfig.json"):
        shutil.copyfile(ROOT / name, source / name)
    shutil.copytree(ROOT / "node_modules", scratch / "node_modules", symlinks=True,
                    ignore=shutil.ignore_patterns(".vite", ".vite-temp", ".cache"))
    shutil.copyfile(ROOT / "demo/tools/security-fixture-vite.mjs", scratch / "runner.mjs")
    for path in (scratch / "node_modules").rglob("*"):
        if path.is_symlink() and not path.resolve().is_relative_to(scratch):
            raise RuntimeError(f"Dependency symlink leaves fixture: {path.name}")


def prepare_native(scratch):
    lock = json.loads((ROOT / "package-lock.json").read_text())["packages"]
    prepared = []
    for name in PACKAGES:
        entry = lock[f"node_modules/{name}"]
        filename = f"{name.split('/')[-1]}-{entry['version']}.tgz"
        assert entry["resolved"] == f"https://registry.npmjs.org/{name}/-/{filename}"
        cached = OUTPUT / (name.replace("/", "-") + ".tgz")
        if cached.exists():
            archive = cached.read_bytes()
        else:
            with urllib.request.urlopen(entry["resolved"], timeout=30) as response:
                archive = response.read(20_000_001)
        assert len(archive) <= 20_000_000
        digest = "sha512-" + base64.b64encode(hashlib.sha512(archive).digest()).decode()
        assert digest == entry["integrity"], f"Integrity mismatch: {name}"
        cached.write_bytes(archive)
        extract_native(archive, scratch / "node_modules" / name)
        prepared.append({"package": name, "version": entry["version"], "integrity": digest})
    return prepared


def extract_native(archive, destination):
    total = 0
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
        for entry in package.getmembers():
            path = Path(entry.name)
            assert path.parts[0] == "package" and ".." not in path.parts
            assert entry.isfile() and len(path.parts) > 1
            total += entry.size
            assert total <= 40_000_000
            target = destination.joinpath(*path.parts[1:])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(package.extractfile(entry).read())
            target.chmod(0o755 if entry.mode & 0o111 else 0o644)


def container_command(scratch, name, variant):
    return [
        "docker", "run", "--rm", "--name", name, "--network", "none",
        "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", "65534:65534", "--memory", "512m", "--memory-swap", "512m",
        "--cpus", "1", "--pids-limit", "64", "--ipc", "none",
        "--ulimit", "cpu=30:30", "--ulimit", "fsize=16777216:16777216",
        "--ulimit", "nofile=128:128", "--ulimit", "nproc=64:64", "--ulimit", "core=0:0",
        "--tmpfs", "/scratch:rw,nosuid,nodev,size=134217728,mode=1777",
        "--mount", f"type=bind,src={scratch},dst=/fixture,readonly",
        "--log-driver", "none", "--entrypoint", "/usr/bin/env", IMAGE,
        "-i", "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/scratch/home",
        "TMPDIR=/scratch", "XDG_CACHE_HOME=/scratch/cache", "PORT=4317",
        "GOMAXPROCS=1", "UV_THREADPOOL_SIZE=1",
        "NODE_OPTIONS=--max-old-space-size=256", "/usr/bin/timeout", "-k", "2", "45",
        "/usr/local/bin/node", "/fixture/runner.mjs", variant,
    ]


def read_output(selector, key, chunks):
    chunk = os.read(key.fd, 4096)
    if not chunk:
        selector.unregister(key.fd)
    chunks.extend(chunk)
    if len(chunks) > 65_536:
        raise RuntimeError("Output exceeds 64 KiB")


def bounded_output(process):
    chunks = bytearray()
    deadline = time.monotonic() + 55
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while selector.get_map():
            if time.monotonic() >= deadline:
                raise TimeoutError("55 second host deadline")
            for key, _ in selector.select(timeout=0.2):
                read_output(selector, key, chunks)
    process.wait(timeout=2)
    return chunks.decode("utf8", errors="replace")


def run_fixture(scratch, variant):
    name = f"waymode-security-{os.getpid()}-{variant}"
    command = container_command(scratch, name, variant)
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        output = bounded_output(process)
        result = json.loads(output.strip().splitlines()[-1])
        result["containerExit"] = process.returncode
        return {"command": command, "result": result}
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=10, check=False)
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    previous = OUTPUT / "report.json"
    if previous.exists():
        shutil.copyfile(previous, OUTPUT / f"report-attempt-{time.time_ns()}.json")
    with tempfile.TemporaryDirectory(prefix="scratch-", dir=OUTPUT) as path:
        scratch = Path(path)
        scratch.chmod(0o755)
        copy_source(scratch)
        native = prepare_native(scratch)
        runs = [run_fixture(scratch, variant) for variant in ("baseline", "fixed")]
        report = {
            "scope": "real demo server with dummy data; Vite filesystem boundary only",
            "image": IMAGE, "nativeToolchain": native, "runs": runs,
            "sourceSha256": hashlib.sha256((scratch / "source/demo/server.ts").read_bytes()).hexdigest(),
            "harnessSha256": hashlib.sha256((scratch / "runner.mjs").read_bytes()).hexdigest(),
            "viteVersion": json.loads((scratch / "node_modules/vite/package.json").read_text())["version"],
            "targetFilesRetained": False,
        }
    (OUTPUT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if all(run["result"]["passed"] for run in runs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
