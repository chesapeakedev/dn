#!/usr/bin/env bash
# Copyright 2026 Chesapeake Computing
# SPDX-License-Identifier: Apache-2.0

# ============================================================================
# Deslop: Technical Debt Cleanup Checks
# ============================================================================
# This file contains automated checks for identifying technical debt
# introduced by multiple LLM agents. See plans/deslop.md for details.
#
# This file is a test for using a Makefile as a standard pairing with a system
# prompt to improve verification of the output

# Directories to check (src/ for Discord bot, kickstart/ for kickstart, shared/ for utilities, cli/ for CLI)
CHECK_DIRS := src/ kickstart/ shared/ cli/
CHECK_DIRS_PATTERN := src/ kickstart/ shared/ cli/

.PHONY: deslop deslop-phase1 deslop-phase2 deslop-phase3 deslop-phase4 deslop-phase5 deslop-phase6
.PHONY: check-imports check-naming check-errors check-types check-modules check-deps check-tests
.PHONY: check-config check-logging check-docs check-security check-async check-incomplete check-artifacts

# Run all automated deslop checks
deslop: precommit deslop-phase1 deslop-phase2 deslop-phase3 deslop-phase4 deslop-phase5 deslop-phase6
	@echo "✓ All deslop checks complete"

# Phase 1: Automated Discovery
deslop-phase1: check-imports check-naming check-errors check-types
	@echo "✓ Phase 1 checks complete"

# Phase 2: Structural Analysis
deslop-phase2: check-modules check-deps check-tests
	@echo "✓ Phase 2 checks complete"

# Phase 3: Functional Inconsistencies
deslop-phase3: check-config check-logging
	@echo "✓ Phase 3 checks complete"

# Phase 4: Documentation
deslop-phase4: check-docs
	@echo "✓ Phase 4 checks complete"

# Phase 5: Security and Best Practices
deslop-phase5: check-security check-async
	@echo "✓ Phase 5 checks complete"

# Phase 6: Agent-Specific Patterns
deslop-phase6: check-incomplete check-artifacts
	@echo "✓ Phase 6 checks complete"

# ----------------------------------------------------------------------------
# Phase 1.2: Import Analysis
# ----------------------------------------------------------------------------
check-imports:
	@echo "Checking imports..."
	@echo "--- All import statements ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "^import" $$dir --include="*.ts" 2>/dev/null | head -20 || true; \
		fi; \
	done
	@echo ""
	@echo "--- Checking for CommonJS remnants (require/module.exports) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "\\brequire\\b\|module\\.exports" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -1 || echo "  ✓ No CommonJS found"
	@echo ""
	@echo "--- Verifying imports resolve ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			deno check $$dir**/*.ts 2>&1 | grep -i "error\|cannot find" || true; \
		fi; \
	done | head -1 || echo "  ✓ All imports resolve"

# ----------------------------------------------------------------------------
# Phase 1.3: Naming Convention Audit
# ----------------------------------------------------------------------------
check-naming:
	@echo "Checking naming conventions..."
	@echo "--- Files not matching camelCase.ts ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			find $$dir -name "*.ts" 2>/dev/null | grep -E "(PascalCase|kebab-case|snake_case)" || true; \
		fi; \
	done | head -1 || echo "  ✓ All files match camelCase"
	@echo ""
	@echo "--- Potential constant naming violations (const with lowercase) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "const [a-z][a-zA-Z]* = " $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -10 || echo "  ✓ No obvious violations found"
	@echo ""
	@echo "--- Files in root that should be in subdirectories ---"
	@find . -maxdepth 1 -name "*.ts" -not -name "*_test.ts" -not -name "main.ts" | grep -v "^\./src/\|^\./kickstart/\|^\./shared/\|^\./cli/" || echo "  ✓ No misplaced files"

# ----------------------------------------------------------------------------
# Phase 1.4: Error Handling Patterns
# ----------------------------------------------------------------------------
check-errors:
	@echo "Checking error handling patterns..."
	@echo "--- Empty catch blocks (potential silent error swallowing) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "catch.*{" $$dir --include="*.ts" -A 3 2>/dev/null | grep -B 1 "^\s*}\s*$$" || true; \
		fi; \
	done | head -1 || echo "  ✓ No empty catch blocks found"
	@echo ""
	@echo "--- Throwing strings instead of Error objects ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "throw ['\"]" $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No string throws found"
	@echo ""
	@echo "--- Promise chains (consider using async/await) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "\.then\|\.catch" $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -10 || echo "  ✓ No promise chains found"

# ----------------------------------------------------------------------------
# Phase 1.5: Type Safety Audit
# ----------------------------------------------------------------------------
check-types:
	@echo "Checking type safety..."
	@echo "--- Use of 'any' type ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r ": any\|as any" $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No 'any' types found"
	@echo ""
	@echo "--- Non-null assertions (!) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "[^/]!" $$dir --include="*.ts" 2>/dev/null | grep -v "//\|/\*" || true; \
		fi; \
	done | head -20 || echo "  ✓ No non-null assertions found"
	@echo ""
	@echo "--- Exported functions (check for missing return types) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "^export.*function\|^export.*async function" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -20 || echo "  ✓ No exported functions found"

# ----------------------------------------------------------------------------
# Phase 2.1: Module Organization
# ----------------------------------------------------------------------------
check-modules:
	@echo "Checking module organization..."
	@echo "--- Large files (>300 lines may indicate multiple responsibilities) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			find $$dir -name "*.ts" -exec wc -l {} + 2>/dev/null || true; \
		fi; \
	done | sort -rn | head -10
	@echo ""
	@echo "--- Directory structure ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			echo "=== $$dir ==="; \
			tree $$dir -I node_modules 2>/dev/null || find $$dir -type d 2>/dev/null | sort || true; \
		fi; \
	done

# ----------------------------------------------------------------------------
# Phase 2.3: Dependency Analysis
# ----------------------------------------------------------------------------
check-deps:
	@echo "Checking dependencies..."
	@echo "--- Dependencies in deno.json ---"
	@cat deno.json | grep -A 20 "imports" || echo "  No imports found"
	@echo ""
	@echo "--- Verifying all imports resolve ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			deno check $$dir**/*.ts 2>&1 | grep -i "error\|cannot find" || true; \
		fi; \
	done | head -1 || echo "  ✓ All dependencies resolve"

# ----------------------------------------------------------------------------
# Phase 2.4: Test Coverage Gaps
# ----------------------------------------------------------------------------
check-tests:
	@echo "Checking test coverage..."
	@echo "--- Test files found ---"
	@find . -name "*_test.ts" -o -name "*.test.ts" | sort
	@echo ""
	@echo "--- Source files without corresponding tests (manual review needed) ---"
	@for check_dir in $(CHECK_DIRS); do \
		if [ -d "$$check_dir" ]; then \
			for f in $$(find $$check_dir -name "*.ts" -not -name "*_test.ts" -not -name "*.test.ts" 2>/dev/null); do \
				base=$$(basename $$f .ts); \
				dir=$$(dirname $$f); \
				test_file="$$dir/$${base}_test.ts"; \
				if [ ! -f "$$test_file" ]; then \
					echo "  Missing test: $$f"; \
				fi; \
			done || true; \
		fi; \
	done | head -1 || echo "  ✓ All source files have tests"

# ----------------------------------------------------------------------------
# Phase 3.2: Configuration and Environment
# ----------------------------------------------------------------------------
check-config:
	@echo "Checking configuration..."
	@echo "--- Hardcoded values that might be config ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "localhost\|127.0.0.1\|https://api\." $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No hardcoded URLs found"
	@echo ""
	@echo "--- Environment variable usage ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "Deno.env.get\|process.env" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -20 || echo "  ✓ No env var usage found"

# ----------------------------------------------------------------------------
# Phase 3.3: Logging and Observability
# ----------------------------------------------------------------------------
check-logging:
	@echo "Checking logging patterns..."
	@echo "--- Console.* usage (should be at system boundaries only) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "console\." $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No console.* usage found"
	@echo ""
	@echo "--- Logging library imports ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "import.*log\|import.*logger" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -1 || echo "  ✓ No logging libraries found"

# ----------------------------------------------------------------------------
# Phase 4.1: Code Documentation
# ----------------------------------------------------------------------------
check-docs:
	@echo "Checking documentation..."
	@echo "--- TODO/FIXME/XXX/HACK comments ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -ri "TODO\|FIXME\|XXX\|HACK" $$dir --include="*.ts" 2>/dev/null | grep -v "//.*TODO.*done\|//.*FIXME.*fixed" || true; \
		fi; \
	done | head -1 || echo "  ✓ No TODOs found"
	@echo ""
	@echo "--- Exported functions (check for JSDoc) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "^export.*function\|^export.*async function" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -20 || echo "  ✓ No exported functions found"

# ----------------------------------------------------------------------------
# Phase 5.1: Security Audit
# ----------------------------------------------------------------------------
check-security:
	@echo "Checking security issues..."
	@echo "--- Potential secrets in code (be careful - may have false positives) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -ri "password\|secret\|key\|token" $$dir --include="*.ts" 2>/dev/null | grep -v "//\|/\*\|Deno.env\|process.env\|@discordeno\|@libsql" || true; \
		fi; \
	done | head -1 || echo "  ✓ No obvious secrets found"
	@echo ""
	@echo "--- Dangerous patterns (eval, Function constructor) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "eval\|Function(" $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No dangerous patterns found"

# ----------------------------------------------------------------------------
# Phase 5.2: Async and Concurrency
# ----------------------------------------------------------------------------
check-async:
	@echo "Checking async patterns..."
	@echo "--- Promise chains (prefer async/await) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "\.then\|\.catch" $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No promise chains found"
	@echo ""
	@echo "--- Async functions (manual review for missing await) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "async function" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -20 || echo "  ✓ No async functions found"

# ----------------------------------------------------------------------------
# Phase 6.1: Incomplete Implementations
# ----------------------------------------------------------------------------
# FIXME: expand this
check-incomplete:
	@echo "Checking for incomplete implementations..."
	@echo "--- Not implemented errors ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -ri "not implemented\|NotImplemented" $$dir --include="*.ts" 2>/dev/null | grep -v "//" || true; \
		fi; \
	done | head -1 || echo "  ✓ No 'not implemented' found"
	@echo ""
	@echo "--- Stub/placeholder/mock functions ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -ri "stub\|placeholder\|mock" $$dir --include="*.ts" 2>/dev/null | grep -v "//\|_test\|test" || true; \
		fi; \
	done | head -10 || echo "  ✓ No stubs found"

# ----------------------------------------------------------------------------
# Phase 6.2: Agent-Generated Artifacts
# ----------------------------------------------------------------------------
check-artifacts:
	@echo "Checking for agent-generated artifacts..."
	@echo "--- Debug statements ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -ri "console\.log\|console\.debug\|debugger" $$dir --include="*.ts" 2>/dev/null | grep -v "//\|/\*\|_test" || true; \
		fi; \
	done | head -1 || echo "  ✓ No debug statements found"
	@echo ""
	@echo "--- Commented-out code blocks (first 20) ---"
	@for dir in $(CHECK_DIRS); do \
		if [ -d "$$dir" ]; then \
			grep -r "^[[:space:]]*//.*[a-zA-Z]" $$dir --include="*.ts" 2>/dev/null || true; \
		fi; \
	done | head -20 || echo "  ✓ No commented code found"
# Color helpers (disable with NO_COLOR=1)
ifeq ($(NO_COLOR),)
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BOLD := \033[1m
RESET := \033[0m
else
RED :=
GREEN :=
YELLOW :=
BOLD :=
RESET :=
endif
