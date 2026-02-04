# Contributing to Kickstart

This document describes the internal workings of kickstart, including how system prompts, plan files, and prompt assembly function.

## System Prompts

Kickstart uses two system prompt files that define the behavior of the AI agent during different phases:

### System Prompt Files

1. **`system.prompt.plan.md`** - Used during the plan phase (read-only analysis)
   - Instructs the agent to analyze the issue and create a plan
   - Enforces read-only mode (only plan files can be written)
   - Defines the structure and format of plan files
   - Includes instructions for continuing existing plans

2. **`system.prompt.implement.md`** - Used during the implement phase (code changes)
   - Instructs the agent to implement the planned changes
   - Allows file modifications within the workspace
   - Emphasizes minimal, focused changes
   - Includes non-interactive mode requirements

### System Prompt Loading

System prompts are embedded in the compiled binary using Deno's `--include` flag during compilation. This ensures:
- Prompts are always available, even when running the compiled binary
- No external file dependencies at runtime
- Consistent behavior across different environments

The orchestrator loads prompts from the embedded files and writes them to temporary files for use with opencode.

## Plan Files

Kickstart manages plan files in a `plans/` directory in the workspace root. The directory is automatically created if it doesn't exist.

### Plan File Locations

- All plans are named: `plans/[name].plan.md`
- Both normal mode and AWP mode prompt for a plan name
- In AWP mode, the branch name is suggested as the default plan name

### Plan File Behavior

**Normal Mode:**
- Prompts for plan name
- If file exists, prompts whether to continue existing plan or start new
- Supports iterative development where you refine plans over multiple runs

**AWP Mode:**
- Prompts for plan name (suggests branch/bookmark name if available)
- Creates named plan files for inclusion in PRs
- Provides clear record of what was planned and implemented

### Plan File Structure

Plan files contain:

- **Title** (H1): Issue title
- **Overview**: Brief description
- **Issue Context**: Issue number, description, labels
- **Implementation Plan**: Detailed breakdown
- **Acceptance Criteria**: Checklist with checkboxes (`- [ ]`) - **MUST be updated by implement agent**
- **Code Pointers**: Specific files and locations
- **Notes**: Assumptions and considerations

### Plan File Examples

```bash
# Normal mode - prompts for plan name
./kickstart <issue_url>

# Normal mode - specific plan name (no prompt)
./kickstart --saved-plan my-feature <issue_url>

# AWP mode - will prompt for plan name (suggests branch name)
./kickstart --awp <issue_url>

# AWP mode - specific plan name
./kickstart --awp --saved-plan issue-123 <issue_url>
```

### Benefits

- **Cursor Integration**: Cursor IDE can read the plan file and track progress via checklists
- **Documentation**: Provides structured information about the implementation
- **Debugging**: Historical record of what was planned vs. what was implemented
- **Git Tracking**: Can be committed to git for version history
- **Progress Tracking**: Updated with implementation timestamps after completion

## Prompt Assembly

The script combines multiple sources into a single prompt file:

1. **System prompt** (`system.prompt.plan.md` or `system.prompt.implement.md`)
2. **Project guidelines** (`AGENTS.md` from project root, if it exists)
3. **Project configuration** (`deno.json` or `package.json` from project root, if it exists)
4. **Previous plan** (plan phase only, if continuing existing plan) - Existing plan content
5. **Plan output** (implement phase only) - Output from plan phase
6. **Issue context** (from GitHub API or local file)

Each section is separated by markdown horizontal rules (`---`).

### Issue Context Format

When fetching from GitHub, the issue context is formatted as:

```markdown
# Issue #123: Issue Title

Issue body/description here...

---

## Labels

- label1
- label2
```

When using a local file, the script attempts to parse issue number and title from a header in the format `# Issue #123: Title`.
