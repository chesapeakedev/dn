#!/usr/bin/env python3
"""Build demo/dn-demo.cast (asciicast v2) from captures/."""
from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CAP = ROOT / "captures"
OUT = ROOT / "dn-demo.cast"
COLS, ROWS = 100, 32


def read(name: str) -> str:
    return (CAP / name).read_text()


def main() -> None:
    kick = "\n".join(read("kickstart.txt").splitlines()[:26]) + "\n"
    steps: list[tuple[str, object]] = [
        ("clear", None),
        ("banner", " dn — CLI for agentic workflows"),
        ("say", "# Turn issues into plans, then into working code."),
        ("run", ("dn --version", read("version.txt"))),
        ("run", ("dn", read("help.txt"))),
        ("say", "# What should we work on next?"),
        ("run", ("dn peek -n 3 --compact --no-urls", read("peek.txt"))),
        ("say", "# Project velocity (last week)"),
        ("run", ("dn glance --compact --no-urls -d 7", read("glance.txt"))),
        ("say", "# Inspect an open issue"),
        ("run", ("dn issue show 3 --no-comments", read("issue-demo.txt"))),
        ("say", "# From issue → plan → implement"),
        ("run", ("dn kickstart --help", kick)),
        ("say", "# Ready when you are:  dn kickstart <issue>"),
        ("pause", 1.0),
    ]

    events: list[list[object]] = []
    t = 0.0

    def emit(delay: float, data: str) -> None:
        nonlocal t
        t += delay
        events.append([round(t, 6), "o", data])

    prompt = "\x1b[1;36m$\x1b[0m "
    dim, reset, bold = "\x1b[2m", "\x1b[0m", "\x1b[1m"

    for kind, payload in steps:
        if kind == "clear":
            emit(0.05, "\x1b[2J\x1b[H")
        elif kind == "banner":
            emit(0.5, f"{bold}{payload}{reset}\r\n")
            emit(0.7, "")
        elif kind == "say":
            emit(0.4, f"{dim}{payload}{reset}\r\n")
            emit(0.65, "")
        elif kind == "pause":
            emit(float(payload), "")  # type: ignore[arg-type]
        elif kind == "run":
            cmd, output = payload  # type: ignore[misc]
            emit(0.25, prompt)
            for ch in cmd:
                emit(0.032, ch)
            emit(0.18, "\r\n")
            lines = output.replace("\r\n", "\n").split("\n")
            for i, line in enumerate(lines):
                suffix = "\r\n" if i < len(lines) - 1 or output.endswith("\n") else ""
                emit(0.35 if i == 0 else 0.045, line + suffix)
            emit(0.85, "")

    header = {
        "version": 2,
        "width": COLS,
        "height": ROWS,
        "timestamp": int(time.time()),
        "title": "dn — agentic workflow CLI",
        "env": {"SHELL": "/bin/zsh", "TERM": "xterm-256color"},
        "idle_time_limit": 1.5,
    }
    with OUT.open("w", encoding="utf-8") as f:
        f.write(json.dumps(header, ensure_ascii=False) + "\n")
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    print(f"wrote {OUT}  events={len(events)}  duration≈{t:.1f}s")


if __name__ == "__main__":
    main()
