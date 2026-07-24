# denoise-docs TODO

Documentation to add to denoise-docs from the `dn` repository.

- [ ] Explain how denoise connects to and uses a developer device runner
      ([chesapeake#213](https://github.com/chesapeakedev/chesapeake/issues/213)).
  - [ ] Walk through **Settings > Runners** pairing with
        `dn runner connect <code> --install`, browser approval, device naming,
        and the paired/online/repository-ready states.
  - [ ] Show explicit checkout trust with `dn runner register`, readiness checks
        with `dn runner doctor`, and the local files and user-service locations
        on macOS and Linux.
  - [ ] Explain how to select a named device for kickstart, what happens when it
        is busy or offline, the 24-hour queue, and the guarantee that denoise
        does not silently fall back to hosted compute.
  - [ ] Document `dn runner status`, `jobs`, `kickstart --wait`, `pause`,
        `resume`, `rotate`, `unregister`, and `disconnect`, including stable
        `--json` examples for agent use.
  - [ ] Describe the security boundary: outbound HTTPS only, owner-only
        dispatch, repository allowlisting, typed kickstart jobs, local
        GitHub/agent credentials, progress redaction, cancellation, and explicit
        retry after lease interruption.
  - [ ] Show the completion receipt fields—device, agent, duration, PR link,
        local compute minutes, and hosted run avoided—without claiming dollar
        savings.
  - [ ] Add troubleshooting for expired credentials, unsupported protocol
        versions, missing agent harnesses, repository remote mismatches, and
        launchd/systemd logs.
  - [ ] Link to the self-hosted GitHub Actions runner guide only as the advanced
        alternative for arbitrary Actions workflows.

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

- [ ] Create a dedicated dn/denoise plan lifecycle page
      ([chesapeake#396](https://github.com/chesapeakedev/chesapeake/issues/396)).
  - [ ] Start with the shared model: Denoise helps people choose and shape the
        work; `dn` turns that intent into a durable plan, implementation, and
        close-out workflow.
  - [ ] Compare the three useful levels of control:
    - `dn kickstart` for the shortest end-to-end path, including publishing when
      configured.
    - `dn kickstart` → `dn land` when the agent should plan and implement in one
      run but the user wants a separate local review and commit boundary.
    - `dn meld` → `dn loop` → `dn land` when planning, implementation, and
      close-out each need an explicit review or automation boundary.
  - [ ] Explain that `meld` accepts one issue, many issues, or local Markdown
        sources and is the only plan-phase command; do not teach `prep`.
  - [ ] Show how durable `plans/*.plan.md` files make work resumable across
        sessions and portable across OpenCode, Claude Code, Cursor, and Codex.
  - [ ] Include batch examples for processing a prioritized set of issues in a
        shell script and examples of asking an existing agent harness to invoke
        the same commands through the installed `dn` skill.
  - [ ] Explain `land --issue-testplan`, `fixup` as the pull-request feedback
        path, and optional `sync` as trunk publication without making them look
        like mandatory stages.
  - [ ] Show expected artifacts and safe restart points after each command so
        users can recover from an interrupted agent run.

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
