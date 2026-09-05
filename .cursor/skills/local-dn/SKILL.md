---
name: local-dn
description: >-
  Install or reuse the local dn CLI from this checkout (make install /
  make configure), then capture terminal proof with asciinema. Use when
  recording local dn, taking a CLI screenshot, proving a GitHub issue is
  done against the binary, or confirming ~/.local/bin/dn is this tree.
  Not the generated dn kickstart skill, not local-denoise (UI + browser),
  not the frozen docs/demo marketing cast.
---

# Local dn (install + asciinema)

Bring up **this checkout’s** `dn` binary, then inspect it in a terminal.
Orchestrating kickstart / meld / loop is the generated **`dn`** skill. Denoise
UI and pairing `--api-url` are **local-denoise**. The README cast under
[`docs/demo/`](../../../docs/demo/README.md) is a marketing rebuild, not live
proof.

Terminal recordings and issue-completion proof: [visual.md](visual.md).

## Do not

- Use `cursor-ide-browser`, Playwright, ffmpeg, `agg`, or `script(1)` to fake a
  CLI recording. Capture with **asciinema** only ([visual.md](visual.md)).
- Treat `make test` or frozen
  [`docs/demo/captures/`](../../../docs/demo/captures/) as visual proof. Do not
  run `docs/demo/build-cast.py` or `docs/demo/record-dn-demo.sh` as a stand-in
  for a live rec.
- Install Deno or asciinema for the user. If either is missing, ask them.
- Commit `.cast` files.
- Comment on or close a GitHub issue unless the user asks.

## 1. Health, then install if needed

```bash
export PATH="$HOME/.local/bin:$PATH"
command -v dn
dn --version
which dn
```

Reuse an already-installed binary when `which dn` is `$HOME/.local/bin/dn` and
`dn --version` matches this tree (`deno.json` `version`). After CLI source
changes, reinstall even if the version string is unchanged.

If missing or stale, from this repo root (`configure` ≡ `install`; there is no
`make build`):

```bash
make install
export PATH="$HOME/.local/bin:$PATH"
dn --version
which dn   # must be $HOME/.local/bin/dn
```

If `make install` cannot build (Deno missing, compile error), stop and ask the
user to run `make configure`. Do not install Deno yourself.

## 2. See the CLI (asciinema)

Everyday `dn` usage stays in the shell. When the user wants a **screenshot**, a
**short recording**, or **visual proof** that local dn is up or that a GitHub
issue is done, follow [visual.md](visual.md).
