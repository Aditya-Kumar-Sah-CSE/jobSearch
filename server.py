#!/usr/bin/env python3
"""JobHunt Web Dashboard Server.

Provides a clean local web GUI so you never have to open the terminal every day.
Supports:
- One-click job search & email delivery
- Real-time live execution logs
- Interactive digest & application materials viewer
- Company management (add/remove ATS boards)
- Filter customization (titles, locations, score threshold)
- Application tracker history
"""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yaml

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
HOST = "127.0.0.1"
PORT = 5000

# Global runner state
runner_lock = threading.Lock()
runner_state = {
    "is_running": False,
    "current_stage": "idle",
    "last_run": None,
    "last_exit_code": 0,
    "logs": [],
}


def add_log(msg: str) -> None:
    timestamp = time.strftime("%H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    runner_state["logs"].append(formatted)
    if len(runner_state["logs"]) > 500:
        runner_state["logs"].pop(0)


def execute_jobhunt(send: bool = False, limit: int | None = None, scorer: str = "llm") -> None:
    with runner_lock:
        if runner_state["is_running"]:
            return
        runner_state["is_running"] = True
        runner_state["logs"] = []
        runner_state["current_stage"] = "starting"

    add_log(f"Starting Job Hunt (send_email={send}, limit={limit}, scorer={scorer})...")

    # Use virtualenv python if available, else sys.executable
    venv_py = ROOT / ".venv" / ("Scripts" if sys.platform == "win32" else "bin") / ("python.exe" if sys.platform == "win32" else "python")
    py_exec = str(venv_py) if venv_py.exists() else sys.executable

    cmd = [py_exec, "-u", "-m", "jobhunt", "run"]
    if send:
        cmd.append("--send")
    if limit:
        cmd.extend(["--limit", str(limit)])
    if scorer == "keyword":
        cmd.extend(["--scorer", "keyword"])

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )
        runner_state["current_stage"] = "running"
        if proc.stdout:
            for line in iter(proc.stdout.readline, ""):
                line_clean = line.rstrip()
                if line_clean:
                    add_log(line_clean)
                    if "[1/5]" in line_clean:
                        runner_state["current_stage"] = "Fetching Boards"
                    elif "[2/5]" in line_clean:
                        runner_state["current_stage"] = "Filtering Postings"
                    elif "[3/5]" in line_clean:
                        runner_state["current_stage"] = "AI Screening"
                    elif "[4/5]" in line_clean:
                        runner_state["current_stage"] = "AI Drafting Kits"
                    elif "[5/5]" in line_clean:
                        runner_state["current_stage"] = "Generating Digest"

            proc.stdout.close()
        proc.wait()
        runner_state["last_exit_code"] = proc.returncode
        if proc.returncode == 0:
            add_log("Job Hunt completed successfully! ✅")
        else:
            add_log(f"Job Hunt exited with status code {proc.returncode} ⚠️")
    except Exception as e:
        add_log(f"Execution error: {e}")
        runner_state["last_exit_code"] = 1
    finally:
        runner_state["is_running"] = False
        runner_state["current_stage"] = "idle"
        runner_state["last_run"] = time.strftime("%Y-%m-%d %H:%M:%S")


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self.handle_api_get(path, parse_qs(parsed.query))
            return

        # Serve static web frontend
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                data = {}
            self.handle_api_post(path, data)
            return

        self.send_error(404, "Not Found")

    def _send_json(self, data: dict | list, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def handle_api_get(self, path: str, query: dict) -> None:
        if path == "/api/status":
            seen_file = ROOT / "seen.json"
            total_seen = 0
            if seen_file.exists():
                try:
                    total_seen = len(json.loads(seen_file.read_text(encoding="utf-8")))
                except Exception:
                    pass

            companies_file = ROOT / "companies.yaml"
            total_companies = 0
            if companies_file.exists():
                try:
                    cdata = yaml.safe_load(companies_file.read_text(encoding="utf-8")) or {}
                    total_companies = len(cdata.get("companies", []))
                except Exception:
                    pass

            digest_file = ROOT / "out" / "digest.html"
            has_digest = digest_file.exists()

            self._send_json({
                "is_running": runner_state["is_running"],
                "current_stage": runner_state["current_stage"],
                "last_run": runner_state["last_run"],
                "last_exit_code": runner_state["last_exit_code"],
                "logs": runner_state["logs"],
                "total_companies": total_companies,
                "total_seen": total_seen,
                "has_digest": has_digest,
            })
            return

        if path == "/api/digest":
            digest_file = ROOT / "out" / "digest.html"
            if not digest_file.exists():
                self._send_json({"found": False, "html": "<p style='color:#8b93a3;text-align:center;'>No digest generated yet. Run Job Hunt to create your first digest!</p>"})
                return
            html_content = digest_file.read_text(encoding="utf-8", errors="replace")
            self._send_json({"found": True, "html": html_content})
            return

        if path == "/api/companies":
            companies_file = ROOT / "companies.yaml"
            if not companies_file.exists():
                self._send_json({"companies": []})
                return
            try:
                cdata = yaml.safe_load(companies_file.read_text(encoding="utf-8")) or {}
                self._send_json({"companies": cdata.get("companies", [])})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        if path == "/api/config":
            config_file = ROOT / "config.yaml"
            if not config_file.exists():
                self._send_json({"config": {}})
                return
            try:
                cfg = yaml.safe_load(config_file.read_text(encoding="utf-8")) or {}
                self._send_json({"config": cfg})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        if path == "/api/tracker":
            seen_file = ROOT / "seen.json"
            items = []
            if seen_file.exists():
                try:
                    data = json.loads(seen_file.read_text(encoding="utf-8"))
                    for jid, info in data.items():
                        info["job_id"] = jid
                        items.append(info)
                except Exception:
                    pass
            # Sort newest first
            items.sort(key=lambda x: (x.get("score") or 0, x.get("first_seen") or ""), reverse=True)
            self._send_json({"items": items})
            return

        self._send_json({"error": "Unknown API endpoint"}, status=404)

    def handle_api_post(self, path: str, data: dict) -> None:
        if path == "/api/run":
            if runner_state["is_running"]:
                self._send_json({"error": "A job search is already running!"}, status=409)
                return

            send = bool(data.get("send", False))
            limit = data.get("limit")
            limit_val = int(limit) if limit and str(limit).isdigit() else None
            scorer = data.get("scorer", "llm")

            t = threading.Thread(
                target=execute_jobhunt,
                kwargs={"send": send, "limit": limit_val, "scorer": scorer},
                daemon=True,
            )
            t.start()
            self._send_json({"success": True, "message": "Job Hunt started in background."})
            return

        if path == "/api/companies":
            companies = data.get("companies")
            if not isinstance(companies, list):
                self._send_json({"error": "Expected list of companies"}, status=400)
                return
            try:
                companies_file = ROOT / "companies.yaml"
                header = (
                    "# Boards to poll. One entry per company.\n"
                    "#   ats: greenhouse | lever | ashby\n"
                    "#   slug: board identifier\n"
                    "#   name: company name\n\n"
                )
                yaml_str = yaml.safe_dump({"companies": companies}, sort_keys=False)
                companies_file.write_text(header + yaml_str, encoding="utf-8")
                self._send_json({"success": True, "count": len(companies)})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        if path == "/api/config":
            new_cfg = data.get("config")
            if not isinstance(new_cfg, dict):
                self._send_json({"error": "Expected config object"}, status=400)
                return
            try:
                config_file = ROOT / "config.yaml"
                yaml_str = yaml.safe_dump(new_cfg, sort_keys=False)
                config_file.write_text(yaml_str, encoding="utf-8")
                self._send_json({"success": True})
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        if path == "/api/tracker/applied":
            job_id = data.get("job_id")
            applied = bool(data.get("applied", True))
            seen_file = ROOT / "seen.json"
            if not seen_file.exists():
                self._send_json({"error": "seen.json not found"}, status=404)
                return
            try:
                seen_data = json.loads(seen_file.read_text(encoding="utf-8"))
                if job_id in seen_data:
                    seen_data[job_id]["applied"] = applied
                    seen_data[job_id]["applied_on"] = time.strftime("%Y-%m-%d") if applied else None
                    seen_file.write_text(json.dumps(seen_data, indent=2), encoding="utf-8")
                    self._send_json({"success": True})
                    return
                self._send_json({"error": "Job ID not found"}, status=404)
            except Exception as e:
                self._send_json({"error": str(e)}, status=500)
            return

        if path == "/api/reset-seen":
            seen_file = ROOT / "seen.json"
            seen_file.write_text("{}", encoding="utf-8")
            self._send_json({"success": True, "message": "seen.json has been reset."})
            return

        self._send_json({"error": "Unknown API endpoint"}, status=404)


def start_server() -> None:
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    server = HTTPServer((HOST, PORT), DashboardHandler)
    url = f"http://{HOST}:{PORT}"
    print(f"\n=======================================================")
    print(f"  * JobHunt AI Dashboard is running at:")
    print(f"     {url}")
    print(f"  Press Ctrl+C to stop.")
    print(f"=======================================================\n")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping JobHunt Dashboard...")
        server.server_close()


if __name__ == "__main__":
    start_server()
