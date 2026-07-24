# denoise-docs TODO

Documentation to add to denoise-docs from the `dn` repository.

- [ ] Document project base images and the `base-image` skill
      ([chesapeake#351](https://github.com/chesapeakedev/chesapeake/issues/351)).
  - [ ] Explain the golden-image use case and the Docker image contract.
  - [ ] Document `sandbox.docker.image` and the optional declarative
        `sandbox.docker.dockerfile` path.
  - [ ] Show how to install the skill with
        `dn init agents --skill base-image --agent <agent>`.
  - [ ] Cover image customization, version pinning, secret handling, network
        access, and read-only root filesystems.
  - [ ] Link to `chesapeakedev/dn-images` after the public repository is created
        and populated; use `templates/dn-images/` as the source until then.

- [ ] Document the dn command lifecycle for issues
      ([chesapeake#396](https://github.com/chesapeakedev/chesapeake/issues/396)).
  - [ ] Plan: `prep` _or_ `meld` (meld is many-to-one and can replace prep);
        `kickstart` includes plan + implement.
  - [ ] Implement: `loop` / remaining kickstart / `fixup` (PR feedback path).
  - [ ] Close out: `land` (optional `--issue-testplan` upserts `## Test Plan` on
        the linked GitHub issue). Distinguish `--issue-testplan` from
        `--test-plan <path>` (local commit-agent context).
  - [ ] Optional trunk publish: `sync` (not the same as `dn land`).
  - [ ] Explicitly note that meld is **not** a post-loop step (correct the old
        `prep → loop → meld → land` skill sequence).

- [x] Document Cursor Cloud Agent execution for `dn` kickstart and loop
      ([chesapeake#344](https://github.com/chesapeakedev/chesapeake/issues/344)).
  - [x] Explain `--cursor-cloud`, `CURSOR_API_KEY`, and the durable
        fire-and-forget execution model.
  - [x] Document `--ref <git-ref>` and its `main` default.
  - [x] Show kickstart with `--publish pr` and loop with an existing plan file.
  - [x] Compare Cursor Cloud Agents with local `--cursor`, GitHub Actions, and
        `--sandbox docker|exe.dev`.
  - [x] Explain that cloud agents use a remote clone and do not modify the local
        workspace.
