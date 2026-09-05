# Visual captures

Read from [SKILL.md](SKILL.md) first. Use this file when the user wants a
**screenshot**, a **short recording** of a CLI flow, or **visual proof** that
local dn is installed or that a GitHub issue is done.

Bring the binary up with SKILL.md. Capture with **asciinema** only. Do not
install Playwright, ffmpeg, `agg`, or `script(1)` to fake a recording. Do not
rebuild [`docs/demo/`](../../../docs/demo/README.md) as live proof.

---

## Shared capture steps

1. Follow SKILL.md health. Run `make install` only if `dn` is missing or stale.
2. `command -v asciinema`. If it is missing, stop and ask the user to install
   it. Do not `brew install` it yourself.
3. Record with asciinema’s own PTY (`--command`) so Cursor’s shell does not need
   to be a TTY:

   ```bash
   export TERM="${TERM:-xterm-256color}"
   asciinema rec --overwrite \
     --title "dn — <short claim>" \
     --idle-time-limit 1.5 \
     --window-size 100x32 \
     --command '<proving dn invocation>' \
     /tmp/dn-capture-<slug>.cast
   ```

4. Pass `dn --color` only if the rec PTY still strips color.
5. Deliver in the chat reply: the `.cast` path, `asciinema cat` of that file,
   and a one-line confirmation. Do not commit capture files. Do not
   `asciinema upload` unless the user asks. Do not require GIF/SVG converters.
   Do not comment on or close a GitHub issue unless the user asks.

### Screenshot vs short recording

asciinema is a recording. Size the `--command` to the ask:

| Ask                                  | Capture                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| **Screenshot** / one resulting state | One short `--command` of the proving invocation.         |
| **Short video** / a flow             | One `--command` that runs the sequence (`dn a && dn b`). |

Do not collage unrelated tools. Do not substitute `make test` or frozen
`docs/demo/captures/` for either.

---

## Use case: local dn smoke

Smoke that this checkout’s `dn` is on `PATH`. Analog of a workspace screenshot.

**When:** the user asks to record local dn, show dn is installed, capture
`--version`, or confirm `~/.local/bin/dn` is this tree.

1. Follow **Shared capture steps** with:

   ```bash
   --command 'dn --version && dn'
   ```

2. Success: version matches this tree, then the subcommand list, from
   `$HOME/.local/bin/dn`.
3. If `which dn` is some other binary (Homebrew, an old download), that is not a
   local-dn smoke. Stop, `make install`, then recapture.

Deliver the `.cast` path, the `asciinema cat` transcript, and a one-line
confirmation (binary path + version).

---

## Use case: GitHub issue completion proof

Show that a specific issue’s **CLI** is done. The user supplies an issue URL,
`#123`, or `123`.

**When:** “screenshot that this issue is done”, “record a short video of #N”, or
any request to visually prove a GitHub issue against the local `dn` binary.

1. Read the issue before recording:

   ```bash
   dn issue show <issue_url_or_number>
   ```

   Use `--json` when you need structured fields. Map title, body, and acceptance
   criteria to a CLI surface (`dn --help`, a subcommand, a new flag, a short
   successful run). If the issue has no CLI surface, say so and do not fake a
   cast.

2. Bring up the binary (SKILL.md) unless it is already healthy.
3. Run the proving command the way a user would. Check empty/error states the
   issue names.
4. Capture:
   - **One screenshot** when a single resulting state proves the issue.
   - **Short recording** when the issue is a flow (`dn a && dn b`).
5. Compare the capture to the issue. If behavior does not match, say it is not
   done and show what you actually got.

Do not record a full `kickstart` / `loop` agent session unless the issue is
specifically that live output. Prefer `--help`, a short successful run, or the
new flag.

Deliver: issue ref, command recorded, what the CLI showed vs the issue, the
`.cast` path, and the `asciinema cat` transcript. Leave GitHub state unchanged
unless asked.

---

## Adding a use case

Add a section to this file. Keep SKILL.md as the only bring-up instructions.
Each use case should state:

1. **When** to use it (trigger phrases).
2. **Target command** (and how to derive it).
3. **What success looks like** in the terminal.
4. **What to deliver** in the reply.
