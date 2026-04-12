# project todo

you are an autonomous senior software engineer. This is a living document
containing a checklist of tasks to be completed. Your job is to take at least 1
task from this list, implement it, and update the checklist to show the task is
complete.

- [x] add a new system prompt that rates the complexity of a user prompt on a
      scale of 1-3, with 3 being the most complex tasks
- [x] add global flag to dn to reference individual files to include in the
      context
- [x] docs directory should be edited for clarity and referenced in README.md,
      CONTRIBUTING.md, and AGENTS.md
- [x] add documentation for compiling kickstart standalone or remove the
      compilation script
- [x] change the cli compilation output name to `.dn` from `dn` so that it
      doesn't show up in the default `ls` listing of the repo directory
- [ ] update fixtures from plans directory, maybe generate some new ones first
- [ ] sdk directory is organized weird, should be better organized by domain
      using hexagon architecture
- [x] dn release: implement list, view, edit, delete subcommands
- [x] dn release: add tests for release module (api, assets, create)
- [x] dn release: support --latest=false flag syntax (currently only --latest
      false works)
- [x] refactor github actions workflows to use `dn issue comment` instead of
      `actions/github-script@v7` and external reusable workflows
- [x] add `GITHUB_REPOSITORY` env var support to `getCurrentRepoFromRemote()` so
      dn works in CI without checkout
- [ ] markdown OCI artifact so prompts can be easily stored in a registry
- [ ] dn init ralph - install daily github actions workflow that iterates on
      todo.plan.md
- [ ] have agent use dn to spawn subagent in a completely separate context (like
      another local repo) then report status back up to the calling agent

## Unfinished: dn init-build enhancements

- [x] Create `sdk/auth/config.ts` - Load/save agent preference to
      `~/.dn/config.json`
- [x] Modify `cli/init-build.ts` - Add agent selection, generate workflow with
      hardcoded agent, output secrets instructions
- [x] Update `.github/templates/denoise-build.yaml` - Simplify (remove agent
      dropdown)
- [x] Run lint/typecheck before finalizing

## What is a good plan?

- executive summary
- description of current state, including
  - code pointers: references to lines of code and copied snippets of code to
    explain WHERE problems are
  - diagrams of current state, using ASCII or mermaidjs
- description of target state, including
  - code pointers: references & copied snippets to explain what sections of code
    are changing or being replaced
  - diagrams of target state, using ASCII or mermaidjs so that target can be
    compared to current
- phased plan recorded as markdown checklist
  - sections of the phased plan that are not obvious should have references to
    the target state section of the plan
