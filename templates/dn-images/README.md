# dn-images

Default **golden image** Dockerfile for
[dn](https://github.com/chesapeakedev/dn) Docker sandboxes. Fork this tree (or
the future
[`chesapeakedev/dn-images`](https://github.com/chesapeakedev/dn-images) repo),
add only the toolchains your project needs, build/push, then point
`.github/dn/config.json` at the published image.

This template is the extractable twin of dn’s curated kickstart image
(`ghcr.io/chesapeakedev/dn-kickstart`, built from `docker/Dockerfile` in the dn
repo). Prefer `dn-kickstart` when you need the stock sandbox; fork here when you
need a project-specific base.

## Image contract

The final image must include:

- Deno runtime (≥ 2.6.3)
- `dn` CLI
- An agent harness (opencode by default)
- `git` and a shell (`bash`)

dn’s Docker sandbox runner starts a long-lived container and `docker exec`s
agent phases. This Dockerfile uses `ENTRYPOINT ["sleep", "infinity"]` for that
lifecycle.

## Build (from the dn monorepo)

```bash
docker build -t ghcr.io/OWNER/dn-images:latest -f templates/dn-images/Dockerfile .
```

## Wire into dn config

```json
{
  "schema_version": "1.1",
  "agent": "opencode",
  "sandbox": {
    "provider": "docker",
    "docker": {
      "image": "ghcr.io/OWNER/dn-images:sha-abc1234",
      "dockerfile": "Dockerfile",
      "network": "bridge",
      "read_only_root": true,
      "env_pass_through": [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "CURSOR_API_KEY"
      ]
    }
  }
}
```

`dockerfile` is declarative (rebuild/CI); dn does not build at provision time.

Install the project skill that documents hygiene and overlays:

```bash
dn init agents --skill base-image --agent opencode
```

## Publishing `chesapeakedev/dn-images` (manual ops)

If the GitHub repository does not exist yet and you have org permissions:

```bash
gh repo create chesapeakedev/dn-images --public --description "dn golden images for Docker sandboxes"
# Copy templates/dn-images/* into the new repo, adjust Dockerfile COPY/install
# to use released dn binaries instead of monorepo sources, then push.
```

If `gh repo create` fails, keep using this vendored tree until the remote repo
can be created.

## Customization suggestions

- Pin `FROM` by digest for locked rebuilds
- Add Sapling (`sl`) when the consumer repo uses Sapling
- Add Node, Python, or Rust toolchains only when the project needs them
- Prefer `:sha-*` tags (or digests) in `sandbox.docker.image` for CI
- Never bake secrets into the image; use `env_pass_through`

See dn’s `docs/sandbox.md` and the `base-image` skill for the full hygiene
checklist.
