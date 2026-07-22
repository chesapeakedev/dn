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
