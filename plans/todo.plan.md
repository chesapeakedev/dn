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
- [ ] add script to the root of the repo to install dn from jsr before moving dn
      out of repo

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
