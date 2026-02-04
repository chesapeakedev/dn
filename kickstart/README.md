## How It Works

Kickstart orchestrates a two-phase workflow (Plan → Implement) with automatic
completion detection, continuation prompt generation, artifact generation, and
optional Cursor IDE integration. Plan files are stored in the `plans/` directory
and can be continued across multiple runs.

**Key Features:**
- **Two-phase execution**: Plan (read-only) → Implement (code changes)
- **Completion detection**: Automatically checks acceptance criteria checklists
- **Continuation prompts**: Generates prompts for incomplete work
- **Plan merging**: Combines plan and continuation files for named plans
- **Artifact generation**: Updates AGENTS.md and creates Cursor rules
- **AWP mode**: Full workflow with branches, commits, and PR creation

### Normal Mode Flow

```mermaid
flowchart TD
    Start([Start]) --> ResolveIssue[Step 1: Resolve Issue Context<br/>Fetch from GitHub or Load File]
    ResolveIssue --> EnsurePlans[Ensure plans/ Directory Exists]
    EnsurePlans --> ResolvePlanPath[Resolve Plan File Path<br/>Prompt for Plan Name]
    ResolvePlanPath --> CheckExisting{Plan File<br/>Exists?}
    CheckExisting -->|Yes| PromptContinue[Prompt: Continue<br/>Existing Plan?]
    CheckExisting -->|No| PlanPhase
    PromptContinue -->|Yes| ReadExisting[Read Existing Plan Content]
    PromptContinue -->|No| PlanPhase
    ReadExisting --> PlanPhase[Step 3: Plan Phase<br/>Read-only Analysis<br/>Creates plans/[name].plan.md]
    PlanPhase --> ValidatePlan[Validate Plan File<br/>Check Required Sections]
    ValidatePlan --> ImplementPhase[Step 4: Implement Phase<br/>Apply Code Changes<br/>Update Acceptance Criteria]
    ImplementPhase --> CheckCompletion[Step 4.5: Check Completion<br/>Parse Acceptance Criteria<br/>Count Completed Items]
    CheckCompletion --> IsComplete{All Criteria<br/>Complete?}
    IsComplete -->|Yes| RunLint
    IsComplete -->|No| ShowContinuation[Show Continuation Info<br/>Plan file updated]
    ShowContinuation --> RunLint
    MergePlans --> RunLint[Step 5: Run Linting<br/>Non-blocking Warnings]
    RunLint --> GenerateArtifacts[Step 6: Generate Artifacts<br/>Update AGENTS.md<br/>Create Cursor Rules if --cursor]
    GenerateArtifacts --> ValidateChanges[Step 7: Validate Changes<br/>Show File Summary]
    ValidateChanges --> End([End<br/>User Handles Git/PR Manually])
    
    style Start fill:#e1f5e1
    style End fill:#ffe1e1
    style PlanPhase fill:#e1e5ff
    style ImplementPhase fill:#e1e5ff
    style PromptContinue fill:#fff4e1
    style GenerateArtifacts fill:#fff4e1
    style CheckCompletion fill:#ffe5e1
    style ShowContinuation fill:#ffe5e1
```

### AWP Mode Flow

```mermaid
flowchart TD
    Start([Start]) --> ResolveIssue[Step 1: Resolve Issue Context<br/>Fetch from GitHub or Load File]
    ResolveIssue --> DetectVCS[Step 2: Detect VCS<br/>Git or Sapling]
    DetectVCS --> PromptBranch[Prompt: Use Current<br/>or Create New Branch?]
    PromptBranch -->|Use Current| SetBranch[Set Current Branch]
    PromptBranch -->|Create New| PromptBranchName[Prompt for Branch Name<br/>Suggest kickstart/issue_N_slug]
    PromptBranchName --> CreateBranch[Create Branch/Bookmark]
    CreateBranch --> SetBranch
    SetBranch --> EnsurePlans[Ensure plans/ Directory Exists]
    EnsurePlans --> ResolvePlanPath[Resolve Plan File Path<br/>Prompt for Plan Name<br/>Suggest Branch Name]
    ResolvePlanPath --> PlanPhase[Step 3: Plan Phase<br/>Read-only Analysis<br/>Creates plans/[name].plan.md]
    PlanPhase --> ValidatePlan[Validate Plan File<br/>Check Required Sections]
    ValidatePlan --> ImplementPhase[Step 4: Implement Phase<br/>Apply Code Changes<br/>Update Acceptance Criteria]
    ImplementPhase --> CheckCompletion[Step 4.5: Check Completion<br/>Parse Acceptance Criteria<br/>Count Completed Items]
    CheckCompletion --> IsComplete{All Criteria<br/>Complete?}
    IsComplete -->|Yes| RunLint
    IsComplete -->|No| ShowContinuation[Show Continuation Info<br/>Plan file updated]
    ShowContinuation --> RunLint[Step 5: Run Linting<br/>Non-blocking Warnings]
    RunLint --> GenerateArtifacts[Step 6: Generate Artifacts<br/>Update AGENTS.md<br/>Create Cursor Rules if --cursor]
    GenerateArtifacts --> ValidateChanges[Step 7: Validate Changes<br/>Show File Summary]
    ValidateChanges --> CommitPush[Step 8: Commit and Push<br/>Message: #N Title]
    CommitPush --> CreatePR[Step 9: Create PR<br/>Title: #N Title<br/>Body: Closes #N]
    CreatePR --> End([End<br/>PR Created])
    
    style Start fill:#e1f5e1
    style End fill:#ffe1e1
    style PlanPhase fill:#e1e5ff
    style ImplementPhase fill:#e1e5ff
    style PromptBranch fill:#fff4e1
    style PromptBranchName fill:#fff4e1
    style ResolvePlanPath fill:#fff4e1
    style CommitPush fill:#e1ffe1
    style CreatePR fill:#e1ffe1
    style GenerateArtifacts fill:#fff4e1
    style CheckCompletion fill:#ffe5e1
    style ShowContinuation fill:#ffe5e1
```

### Key Differences

**Default Mode:**

- Prompts for plan name when starting
- Prompts to continue existing plan if found
- Plan files persist in `plans/` directory for reference
- You handle git operations manually
- No VCS required
- **Completion Detection**: Automatically checks acceptance criteria after implementation

If the plan file exists, you'll be prompted:

- **Continue existing plan?** (y/n, default: n)
  - `y` or `yes`: Reads existing plan and updates it with new analysis
  - `n` or Enter: Starts a new plan (overwrites existing)

**AWP Mode:**

- Prompts for plan name (suggests branch name)
- Creates named plan files: `plans/[name].plan.md`
- Plan files are included in commits and PRs
- Automatically handles branches, commits, and PRs
- Requires Git or Sapling
- **Completion Detection**: Automatically checks acceptance criteria after implementation

When running in AWP mode, you'll be prompted:

1. **Use current branch/bookmark or create new?**
   - Type `u` (or `use`, `y`, `yes`) to use the current branch/bookmark
   - Type `n` (or press Enter) to create a new one (default)

2. **If creating new: Branch/bookmark name**
   - A suggested name is generated from the issue:
     `kickstart/issue_{number}_{slugified-title}`
   - The `kickstart/` prefix identifies auto-generated branches
   - Press Enter to accept the suggestion, or type a custom name
   - The script validates that the branch doesn't already exist (for Git)

3. **Plan name** (after branch setup)
   - Suggested name matches the branch name
   - Press Enter to accept, or type a custom plan name
   - Plan file will be created at `plans/[name].plan.md`

## CLI Options

### Flags

- `--awp`: Enable AWP mode (full workflow with branches, commits, and PR
  creation)
  - Without this flag, the script runs in default mode (local changes only)

- `--cursor` or `-c`: Enable Cursor IDE integration
  - Creates `.cursor/rules/kickstart.mdc` for subagent integration
  - Can also be set via `CURSOR_ENABLED=1` environment variable

- `--save-plan`: Force a named plan to be saved (prompts for name)
  - Creates a named plan file in `plans/` directory
  - Useful for creating persistent plans that can be referenced later

- `--saved-plan <name>`: Use a specific plan name (no prompt)
  - Creates or updates a plan file at `plans/<name>.plan.md`
  - Useful for CI environments or when you want to specify the plan name upfront

### Positional Arguments

- `<issue_url_or_number>`: Full GitHub issue URL or an issue number for the current repository (optional if `ISSUE` environment variable is set)
  - Full URL format: `https://github.com/owner/repo/issues/123`
  - Issue number shorthand: `123` or `#123` (infers URL from current repo remote)
  - If the URL points to a different repository than the current workspace, kickstart exits with an error
  - The script fetches the issue using GitHub's GraphQL API

## Environment Variables

- `GITHUB_TOKEN`: **Optional (CI/scripts)** - GitHub Personal Access Token for API authentication
  - Preferred: use GitHub CLI (`gh auth login`) or run `dn auth` for browser login; no env var needed
  - For CI (e.g. GitHub Actions), set to `${{ secrets.GITHUB_TOKEN }}`
  - Fine-grained PATs recommended when using a token. Example: `GITHUB_TOKEN=ghp_xxx ./kickstart <issue_url_or_number>`
  - See [docs/authentication.md](../docs/authentication.md) for all options

- `WORKSPACE_ROOT`: Root directory of the workspace (where config files are
  located)
  - Default: Current working directory (`Deno.cwd()`)
  - Use this when running the script from a different directory
  - Example: `WORKSPACE_ROOT=/path/to/workspace ./kickstart <issue_url_or_number>`

- `ISSUE`: GitHub issue URL or issue number (alternative to positional argument)
  - Example: `ISSUE=https://github.com/owner/repo/issues/123 ./kickstart` or `ISSUE=123 ./kickstart`

- `SAVE_CTX`: Set to `"1"` to preserve debug files in the temp directory on
  success
  - Default: Debug files are cleaned up on success, but preserved on failure
  - Debug files are stored in `/tmp/geo-opencode-{pid}/`
  - Example: `SAVE_CTX=1 ./kickstart <issue_url_or_number>`

- `CURSOR_ENABLED`: Set to `"1"` to enable Cursor IDE integration
  - Creates `.cursor/rules/kickstart.mdc` for subagent integration
  - Alternative to using `--cursor` CLI flag
  - Example: `CURSOR_ENABLED=1 ./kickstart <issue_url_or_number>`

- `OPENCODE_TIMEOUT_MS`: Timeout for opencode execution in milliseconds
  - Default: 600000 (10 minutes)
  - Increase if operations are expected to take longer
  - Example: `OPENCODE_TIMEOUT_MS=3600000 ./kickstart <issue_url_or_number>` (1 hour)

## Configuration Files

The script requires OpenCode configuration files in the workspace root. These
files are automatically created if missing.

### Required Files

- **`opencode.plan.json`**: Read-only permissions configuration (required for
  plan phase)
  - Used during the plan phase to restrict file edits (only allows plan files in
    the `plans/` directory)
  - Auto-created with default template if missing

- **`opencode.implement.json`**: Full permissions configuration (required for
  implement phase)
  - Used during the implement phase to allow file edits
  - Must be created manually (see template below)

### Default Plan Config Template

If `opencode.plan.json` is missing, the script automatically creates:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": {
      "*": "deny",
      "/tmp/**": "allow",
      "plans/**/*.plan.md": "allow",
      "plans/*.plan.md": "allow",
      "**/*.plan.md": "allow"
    },
    "bash": {
      "*": "allow"
    },
    "external_directory": "allow"
  }
}
```

### Config File Location

Config files must be in the **workspace root** directory. The workspace root is
determined by:

1. `WORKSPACE_ROOT` environment variable (if set)
2. Current working directory (`Deno.cwd()`) as fallback

## Plan Files

Kickstart manages plan files in a `plans/` directory in the workspace root. The
directory is automatically created if it doesn't exist. Plan files are
persistent workspace artifacts that track implementation progress and can be
integrated with Cursor IDE.

### Plan File Locations

- All plans are named: `plans/[name].plan.md`
- Both normal mode and AWP mode prompt for a plan name
- In AWP mode, the branch name is suggested as the default plan name

### Plan File Structure

Plan files contain structured information about the implementation:

- **Title**: Issue title (H1)
- **Overview**: Brief description of implementation goal
- **Issue Context**: Issue number, description, labels
- **Implementation Plan**: Detailed breakdown of changes
- **Acceptance Criteria**: Checklist format (`- [ ]`) for tracking progress
- **Code Pointers**: Specific files and locations to modify
- **Notes**: Assumptions, questions, or considerations

### Plan Continuation

If the named plan file exists, kickstart will prompt whether to continue the
existing plan. When continuing:

- Existing plan content is read and provided to the planning agent
- Agent can update, enhance, or correct the plan
- Previous analysis and acceptance criteria are preserved
- New analysis is merged with existing content

### Completion Detection

After the implement phase, kickstart automatically:

1. **Parses Acceptance Criteria**: Reads the plan file's Acceptance Criteria section
2. **Counts Completion**: Tracks how many checkboxes are marked `[x]` vs `[ ]`
3. **Reports Status**: Shows completion progress and provides continuation instructions

#### Completion Status

Kickstart reports completion status:
```
📊 Completion Status: 3/5 acceptance criteria completed
⚠️  Plan is incomplete. 2 item(s) remaining.
```

#### Continuing Incomplete Work

For incomplete plans, kickstart shows the plan file location and provides
instructions for continuing:
```
ℹ️  Plan file updated: plans/my-feature.plan.md
ℹ️  To continue this work, run: dn loop --plan-file plans/my-feature.plan.md
```

The plan file itself serves as the continuation point, containing all context
needed to resume the work.

### Cursor IDE Integration

Plan files work seamlessly with Cursor IDE:

- **Checklist tracking**: Cursor can read and track progress via acceptance
  criteria checklists
- **Context awareness**: Plan files provide structured context for agents
- **Progress visibility**: Implementation progress is visible in the plan file
- **Git tracking**: Plan files can be committed to track planning history

Plan files are never automatically deleted - they persist as workspace artifacts
for reference and tracking.

## Artifact Generation

After successful implementation, kickstart automatically generates workspace
artifacts to improve code quality and enable better tooling integration:

### 1. Plan File Updates

- The implement phase updates the Acceptance Criteria checklist in the plan file
- Plan file remains in `plans/` directory for reference
- For incomplete plans, continuation prompts are generated (see Completion Detection section)

### 2. Linting (Non-blocking)

Runs linting commands to improve code quality:

- **Deno projects**: `deno task check` or `deno fmt && deno lint`
- **Node.js projects**: `npm run lint`
- **Other projects**: Detects and runs appropriate lint commands

Linting errors are logged as warnings but don't block execution. This helps
improve code quality for future prompting and development.

### 3. AGENTS.md Generation

Generates or updates `AGENTS.md` with project-specific guidelines:

- **Project type detection**: Automatically detects Deno, Node.js, Python, Rust,
  Go
- **Build commands**: Extracts from `deno.json`, `package.json`, etc.
- **Lint/test commands**: Includes project-specific commands
- **Custom sections**: Preserves any existing custom sections in `AGENTS.md`

This file helps agents understand project conventions and improves
promptability.

### 4. Cursor IDE Integration (Optional)

If `--cursor` flag or `CURSOR_ENABLED=1` is set:

- Creates `.cursor/rules/kickstart.mdc` with `alwaysApply: true`
- Documents how to use kickstart as a subagent in Cursor IDE
- Includes usage examples and workflow information
- Enables Cursor agents to use kickstart for GitHub issue implementation

All artifacts are non-blocking - failures are logged as warnings but don't stop
the workflow.

## Cursor Integration

When using kickstart with Cursor IDE, you can enable subagent integration by
using the `--cursor` flag or setting `CURSOR_ENABLED=1`. Cursor agents will know
how to use kickstart when this integration is enabled. When Cursor integration
is enabled, kickstart creates `.cursor/rules/kickstart.mdc` in your workspace.
This rule file:

- **Always applies** (`alwaysApply: true`) - Cursor will include it in every
  agent context
- **Documents kickstart usage** - Provides examples and workflow information
- **Enables subagent mode** - Cursor's agent can use kickstart as a subagent to
  implement GitHub issues

```bash
# Enable Cursor integration via CLI flag
./kickstart --cursor https://github.com/owner/repo/issues/123

# Or via environment variable
CURSOR_ENABLED=1 ./kickstart https://github.com/owner/repo/issues/123
```

## GitHub Actions Integration

Kickstart can be run in GitHub Actions workflows to automatically process issues and create pull requests. Two workflows are available:

- **`kickstart-opencode.yml`**: Uses the opencode agent harness
- **`kickstart-cursor.yml`**: Uses the Cursor CLI agent harness

### Workflow Triggers

Both workflows support:
- **`workflow_dispatch`**: Manual trigger with `issue_url` input
- **`issues.labeled`**: Automatically triggers when an issue is labeled with **`cursor awp`** (Cursor workflow) or **`opencode awp`** (opencode workflow)

### Required Setup

1. **Install Dependencies**: Workflows automatically install:
   - Deno (via `denoland/setup-deno@v1`)
   - opencode (for opencode workflow)
   - Cursor CLI (for Cursor workflow)

2. **Environment Variables**: 
   - `GITHUB_TOKEN`: Automatically set to `${{ secrets.GITHUB_TOKEN }}`
   - `CURSOR_API_KEY`: Required for Cursor workflow (add to repository secrets)

3. **Permissions**: Workflows require:
   - `contents: write` (for commits)
   - `pull-requests: write` (for PR creation)
   - `issues: write` (for commenting)

### Example Usage

**Manual Trigger (workflow_dispatch):**
1. Go to Actions → Kickstart (opencode) or Kickstart (Cursor)
2. Click "Run workflow"
3. Enter the issue URL
4. Click "Run workflow"

**Issue Label Trigger:**
Add **`cursor awp`** to run the Cursor workflow, or **`opencode awp`** to run the opencode workflow. The triggered workflow will:
1. Extract the issue URL from the issue
2. Run kickstart with AWP mode
3. Create a PR
4. Comment on the issue with results

### Workflow Output

After execution, the workflow posts a comment on the issue with:
- Execution timestamp
- Trigger source (workflow_dispatch or issue_label)
- Status (success/failure)
- PR link (if created)
- Error details (if failed)

### Branch Naming and Force Push

Kickstart creates branches with a `kickstart/` prefix (e.g., `kickstart/issue_123_add-feature`). This prefix identifies auto-generated branches where force push is expected behavior for retries.

When a workflow fails after creating a branch (e.g., PR creation fails), retrying the workflow will force push to the existing branch using `--force-with-lease`. This is safe because:
- The branch is auto-generated and tied to a specific issue
- No one should be collaborating on these kickstart branches
- A retry should replace the failed attempt

### PR Creation Permissions

To allow GitHub Actions to create pull requests, enable this in your repository settings:

1. Go to **Settings** → **Actions** → **General**
2. Scroll to **Workflow permissions**
3. Enable **Allow GitHub Actions to create and approve pull requests**

Without this setting, you'll see: `GitHub Actions is not permitted to create or approve pull requests`

### Self-Hosted Runners

For self-hosted runners, see [`docs/self-hosted-runner-setup.md`](../docs/self-hosted-runner-setup.md) for setup instructions.

### Example Workflow Snippet

```yaml
- name: Run kickstart
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    cd dn
    deno run --allow-all cli/main.ts kickstart --awp "${{ github.event.inputs.issue_url }}"
```

## Troubleshooting

### Debug Files

On failure (or when `SAVE_CTX=1`), debug files are preserved in
`/tmp/geo-opencode-{pid}/`:

- `combined_prompt.txt`: The full combined prompt sent to opencode
- `opencode_stdout.txt`: Standard output from opencode execution
- `opencode_stderr.txt`: Standard error from opencode execution
- `issue-context.md`: The formatted issue context (if fetched from GitHub)

### Common Issues

#### "opencode not found" Error

**Symptom:** Script exits with error about opencode not being in PATH

**Solutions:**

- Install opencode: Follow instructions at [opencode.dev](https://opencode.dev/)
- Verify installation: Run `opencode --version` to confirm it's in your PATH
- Check PATH: Ensure the directory containing `opencode` is in your `PATH`
  environment variable

#### Workspace Root Detection Issues

**Symptom:** Script operates on wrong directory or can't find files

**Causes:**

- Running from unexpected directory
- `WORKSPACE_ROOT` environment variable not set correctly

**Solutions:**

- **Explicit workspace root:** Always set `WORKSPACE_ROOT` when running from a
  different directory:
  ```bash
  WORKSPACE_ROOT=/path/to/workspace ./kickstart <issue_url_or_number>
  ```
- **Run from workspace root:** Change to workspace root before running:
  ```bash
  cd /path/to/workspace
  ./kickstart <issue_url_or_number>
  ```
- **Verify workspace root:** The script will log the workspace root it's using.
  Check console output for workspace information
