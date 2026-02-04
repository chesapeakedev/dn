# Deslop Plan: Cleaning Up Technical Debt from LLM Agents

Remove technical debt using `deslop.mk` to verify the existence of slop. Run
`make deslop` to execute all automated checks.

**Issues to address (grouped by deslop phases):**

## Phase 1: Automated Discovery

- Type errors, `any` types, missing type annotations
- Missing return types on exported functions (omit when `void` or `Promise<void>`)
- Unsafe non-null assertions or undocumented `!`
- Unsafe or incorrect type assertions
- Lint warnings, unused variables, dead code
- Formatting inconsistencies (auto-fix with `deno fmt`)
- Mixed import styles (ESM vs CommonJS remnants)
- Inconsistent import grouping (std → third-party → local)
- Unused imports, circular dependencies
- Missing or incorrect import aliases
- File names not matching `camelCase.ts`
- Constants not using `SCREAMING_SNAKE_CASE`
- Abbreviations that are not universally understood
- One-letter variable names outside small scopes
- Empty `catch` blocks (silent error swallowing)
- Throwing strings instead of `Error` objects
- Broad `catch` blocks that hide root causes
- Mixed async patterns (`.then()` vs `await`)
- Missing `await` on async calls

## Phase 2: Structural Analysis

- Files >300 lines (multiple responsibilities)
- Modules mixing concerns (e.g., database + business logic)
- Files in wrong directories
- Missing or incorrect directory structure
- Similar functions with slight variations
- Repeated error handling patterns
- Duplicate validation logic
- Similar async patterns that could be abstracted
- Unused dependencies in `deno.json`
- Conflicting dependency versions
- Dependencies that could be replaced with std lib
- Missing dependencies (imports that fail)
- Pure functions without tests
- Complex logic without test coverage
- Missing edge case tests
- Tests not following naming conventions (`*_test.ts`)

## Phase 3: Functional Inconsistencies

- Inconsistent function signatures for similar operations
- Different error handling approaches
- Inconsistent return value shapes
- Hardcoded values that should be configurable
- Inconsistent environment variable usage
- Missing configuration validation
- Configuration scattered across multiple files
- Inconsistent log levels and formats
- Logging in wrong places (should be at system boundaries)
- Missing context in log messages
- Missing error handling for async operations

## Phase 4: Documentation

- Missing JSDoc comments on exported functions
- TODO comments without context or ownership
- Outdated comments that do not match code
- Inconsistent comment styles
- Outdated setup instructions
- Missing information about new features
- Broken links
- Missing architecture diagrams

## Phase 5: Security and Best Practices

- Secrets in code or logs
- Logging secrets or sensitive data
- Missing input validation
- Insecure error messages (leaking internal details)
- Unhandled promise rejections
- Race conditions
- SQL injection risks (if using raw SQL)
- Inconsistent transaction handling
- Missing error handling for database operations

## Phase 6: Agent-Specific Patterns

- Stub functions that were never implemented
- `throw new Error("Not implemented")` statements
- Placeholder values (`"TODO"`, `null` returns)
- Functions that always return the same value
- Debug code left in production
- Commented-out code blocks
- Temporary files or directories
- Unused imports from agent experimentation
- Inconsistent error handling in related modules
- Different validation approaches
- Inconsistent logging approaches
