# Test Scenarios

You are a senior engineer. Your role is to write idiomatic Deno tests following
the test plan below. Take a task from the list and implement the task. When
complete, mark off the corresponding checkbox

---

## Phase 0: Test Infrastructure & Conventions

- [ ] `deno test` runs successfully from the repository root
- [ ] Test files follow the `*_test.ts` naming convention
- [ ] Shared test helpers can construct valid fake GitHub inputs
- [ ] Tests do not perform real network requests unless explicitly mocked
- [ ] Arrange → Act → Assert structure is consistently used

---

## Phase 1: Pure Logic & Domain Rules

- [x] CLI argument parsing rejects unknown subcommands
- [ ] Missing required arguments produce a clear error message
- [ ] Help text renders without error for all subcommands
- [ ] Plan file paths are validated before use
- [ ] Archive target paths are validated and normalized
- [ ] Invalid flags or options fail fast with actionable output

---

## Phase 2: Workflow & Orchestration Logic

- [ ] `dn kickstart` runs plan then implement phases in order
- [ ] `dn prep` creates a plan file without running implementation
- [ ] `dn loop` requires a valid plan file and fails if missing
- [ ] `dn archive` derives a commit message from a plan file
- [ ] `dn archive --yolo` commits and removes the plan file
- [ ] `dn meld` correctly merges multiple markdown sources
- [ ] `dn fixup` fetches PR context and prepares a local workflow

---

## Phase 3: Service & Boundary Integration

- [ ] GitHub API failures surface clear, contextual errors
- [ ] Authentication is required before GitHub operations
- [ ] Cached auth tokens are reused when available
- [ ] Network failures do not corrupt local files
- [ ] Partial failures do not leave workflows in inconsistent states

---

## Phase 4: Thin E2E / Smoke Tests (Optional)

- [ ] `dn --help` exits successfully
- [ ] `dn auth` opens browser-based auth flow
- [ ] `dn issue list` runs against a test repository
- [ ] `dn prep` + `dn loop` succeed on a real issue

---

## Non‑Goals Verification

- [ ] No browser-based UI automation is introduced
- [ ] CI avoids destructive GitHub operations
- [ ] Snapshot tests are avoided unless clearly justified
