# dn asciinema demo

Terminal demo of `dn` as an [asciinema](https://asciinema.org/) cast.

## Play

```bash
asciinema play docs/demo/dn-demo.cast
```

Faster / slower:

```bash
asciinema play -s 1.5 docs/demo/dn-demo.cast
asciinema play -s 0.75 docs/demo/dn-demo.cast
```

## Upload (optional)

```bash
asciinema upload docs/demo/dn-demo.cast
```

## Rebuild

Captures under `captures/` are frozen command output. Regenerate the cast:

```bash
python3 docs/demo/build-cast.py
```

For a live TTY recording instead (requires a real terminal / PTY):

```bash
asciinema rec --overwrite --title "dn — agentic workflow CLI" \
  --idle-time-limit 1.5 --window-size 100x32 \
  --command docs/demo/record-dn-demo.sh \
  docs/demo/dn-demo.cast
```
