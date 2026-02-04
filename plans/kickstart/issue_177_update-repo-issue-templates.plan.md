# Update repo issue templates

## Overview

Update the repository's GitHub issue templates to better support the kickstart workflow. This involves creating a single "task" template designed for automated implementation by kickstart, replacing the existing product and bizdev templates which the team does not use.

## Issue Context

- Issue: #177
- Description: Update repo issue templates to be more useful for the kickstart workflow
- Labels: cursor awp

## Implementation Plan

### 1. Create New Task Template

Create a new issue template at `.github/ISSUE_TEMPLATE/task.md` with the following structure:

**YAML Front Matter:**
- `name: Task` - Template name shown in GitHub UI
- `about: A task for kickstart to implement` - Description for template selection
- `title: ""` - Empty title prefix (user fills in)
- `labels: ""` - No default labels
- `assignees: ""` - No default assignees

**Template Body Sections:**

1. **Current State** - Describe what exists now or the problem
2. **Expected State** - Describe the desired outcome
3. **Additional Context** - Optional section for extra information
4. **Hidden Comments** with instructions for:
   - How to add react-grab data (UI context) for frontend issues
   - How to add stdout/logs for useful debugging context

### 2. Remove Existing Templates

Delete the following templates that are not being used:
- `.github/ISSUE_TEMPLATE/product.md`
- `.github/ISSUE_TEMPLATE/bizdev.md`

### 3. Template Design Details

The new task template should include:

```markdown
---
name: Task
about: A task for kickstart to implement
title: ""
labels: ""
assignees: ""
---

## Current State

<!--
    Describe what currently exists or the problem you're experiencing.
    Be specific about the current behavior, error messages, or limitations.
-->

## Expected State

<!--
    Describe what you want to happen after this task is implemented.
    Be clear about the desired outcome and any acceptance criteria.
-->

## Additional Context

<!--
    Add any other context that would help with implementation.
    
    ### Adding UI Context (react-grab)
    
    If this is a frontend issue, you can capture UI context using react-grab:
    1. Run the app in dev mode (npm run dev)
    2. Hover over the relevant element
    3. Press ⌘C (Mac) or Ctrl+C (Windows/Linux) to copy element context
    4. Paste the copied context here
    
    ### Adding Logs/Output
    
    If you have relevant terminal output, logs, or error messages:
    1. Copy the stdout/stderr from your terminal
    2. Paste it here in a code block:
    
    ```
    your output here
    ```
-->
```

## Acceptance Criteria

- [x] New task template created at `.github/ISSUE_TEMPLATE/task.md`
- [x] Template includes "Current State" section with helpful comment
- [x] Template includes "Expected State" section with helpful comment
- [x] Template includes "Additional Context" section with instructions for react-grab data
- [x] Template includes instructions for adding stdout/logs
- [x] Old `product.md` template is deleted
- [x] Old `bizdev.md` template is deleted
- [x] Template uses clean YAML front matter with no default labels or assignees

## Code Pointers

### Files to Create

- `.github/ISSUE_TEMPLATE/task.md`: New task template with current state, expected state sections, and helpful comments for react-grab and stdout

### Files to Delete

- `.github/ISSUE_TEMPLATE/product.md` (lines 1-40): Product development template no longer used
- `.github/ISSUE_TEMPLATE/bizdev.md` (lines 1-29): Business development template no longer used

## Notes

### Assumptions

1. The team wants a minimal, streamlined template rather than a complex multi-field form
2. React-grab instructions should reference the general pattern (⌘C/Ctrl+C on elements) rather than project-specific setup
3. The template should be compatible with kickstart's automated workflow
4. No `config.yml` is needed for the ISSUE_TEMPLATE directory (allowing blank issues to remain an option)

### React-Grab Context

React-grab is a tool used in the denoise web app that allows developers to capture UI context (component info, file location, HTML) by hovering over elements and pressing ⌘C/Ctrl+C. This context can be pasted into issues to provide rich information about which UI elements are affected.

### Kickstart Compatibility

The template structure with "Current State" and "Expected State" aligns well with kickstart's planning phase, which needs to understand:
- What exists now (to analyze the codebase)
- What should exist after implementation (to create a plan)
