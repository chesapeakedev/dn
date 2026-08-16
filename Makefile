SHELL := bash

# Detect OS for sed compatibility (macOS uses BSD sed, Linux uses GNU sed)
ifeq ($(shell uname),Darwin)
    SED_INPLACE := sed -i ''
else
    SED_INPLACE := sed -i
endif

.PHONY: \
	fmt \
	lint \
	actionlint \
	precommit \
	configure \
	sync \
	compile \
	install \
	kickstart_ci_opencode \
	kickstart_ci_cursor \
	kickstart_ci_claude \
	repo_stats \
	tokei \
	tests \
	fixup \
	cursor_lint_prompt \
	pr_from_issue \
	pr_test \
	kickstart \
	glance \
	publish \
	test_subcommands \
	exe_dev_token \
	bump_patch bump_minor bump_major release

fmt: ; deno fmt
lint: fmt actionlint ; deno task typecheck && deno task lint
actionlint: ; @if command -v actionlint >/dev/null 2>&1; then actionlint .github/workflows/*.yml; else go install github.com/rhysd/actionlint/cmd/actionlint@latest >/dev/null && "$$(go env GOPATH)/bin/actionlint" .github/workflows/*.yml; fi
precommit:
	deno task precommit
	deno test --allow-read --allow-write \
		scripts/workflowChecksums_test.ts sdk/workflows/mod_test.ts
# The suite includes filesystem fixtures, temporary VCS checkouts, and CLI
# subprocesses, so it must run with the same broad permissions used by the
# CLI integration tests.
tests: ; NODE_ENV=dev deno test --allow-all
configure: install
publish: ; deno task publish

# sync your local changes with trunk, rebasing trunk under your work
# leaves branches alone
sync: lint tests
	deno run --allow-all $(CURDIR)/cli/main.ts sync --skip-lint

# compile & install dn locally for the current user
TARGET_DIR=~/.local/bin
compile: ; @bash ./compile_dn.sh
install: compile
	@mkdir -p $(TARGET_DIR)
	@cp "./bin/dn" $(TARGET_DIR)/dn
	@chmod +x $(TARGET_DIR)/dn
	@echo "✅ Installed dn to $(TARGET_DIR)/dn"

# Run kickstart using deno run (for GitHub Actions)
# Usage: make kickstart_deno ISSUE=https://github.com/org/repo/issues/123
kickstart_ci_opencode:
	@if [ -n "$(ISSUE)" ]; then \
		deno run --allow-all $(CURDIR)/cli/main.ts kickstart --awp "$(ISSUE)"; \
	else \
		echo "Error: ISSUE environment variable required"; \
		exit 1; \
	fi

# Run kickstart with Cursor integration (for GitHub Actions Cursor workflow)
# Usage: make kickstart_deno_cursor ISSUE=https://github.com/org/repo/issues/123
kickstart_ci_cursor:
	@if [ -n "$(ISSUE)" ]; then \
		deno run --allow-all $(CURDIR)/cli/main.ts kickstart --awp --cursor "$(ISSUE)"; \
	else \
		echo "Error: ISSUE environment variable required"; \
		exit 1; \
	fi

# Run kickstart with Claude Code (for GitHub Actions Claude workflow)
# Usage: make kickstart_ci_claude ISSUE=https://github.com/org/repo/issues/123
kickstart_ci_claude:
	@if [ -n "$(ISSUE)" ]; then \
		deno run --allow-all $(CURDIR)/cli/main.ts kickstart --awp --claude "$(ISSUE)"; \
	else \
		echo "Error: ISSUE environment variable required"; \
		exit 1; \
	fi

# print some stats about the size of the repo
repo_stats: tokei
	tokei -C -n commas \
		-e target \
		-e *.json \
		-e **/node_modules .
tokei: ; hash tokei || cargo install tokei

# Run subcommand tests (for local manual testing only)
# NOTE: This should only be run locally to conserve tokens. These tests
# create temporary git repositories and run dn CLI commands in isolation.
# They are useful for manual testing but should not be run in CI pipelines.
test_subcommands: ; deno test cli/test_*.ts --allow-all

# Generate EXE_TOKEN for dn exe.dev sandbox (lobby API cmds: new, ssh, rm).
# Requires: ssh exe.dev access. Optional: EXE_TOKEN_LABEL, EXE_TOKEN_EXP.
exe_dev_token: ; @bash ./scripts/exe_dev_token.sh

# Version bumping targets
bump_patch:
	@current=$$(grep -o '"version": "[^"]*"' deno.json | cut -d'"' -f4); \
	major=$$(echo $$current | cut -d'.' -f1); \
	minor=$$(echo $$current | cut -d'.' -f2); \
	patch=$$(echo $$current | cut -d'.' -f3); \
	new_version="$${major}.$${minor}.$$((patch + 1))"; \
	$(SED_INPLACE) "s/\"version\": \"$$current\"/\"version\": \"$$new_version\"/" deno.json; \
	echo "Bumped version from $$current to $$new_version"

bump_minor:
	@current=$$(grep -o '"version": "[^"]*"' deno.json | cut -d'"' -f4); \
	major=$$(echo $$current | cut -d'.' -f1); \
	minor=$$(echo $$current | cut -d'.' -f2); \
	new_version="$${major}.$$((minor + 1)).0"; \
	$(SED_INPLACE) "s/\"version\": \"$$current\"/\"version\": \"$$new_version\"/" deno.json; \
	echo "Bumped version from $$current to $$new_version"

bump_major:
	@current=$$(grep -o '"version": "[^"]*"' deno.json | cut -d'"' -f4); \
	major=$$(echo $$current | cut -d'.' -f1); \
	new_version="$$((major + 1)).0.0"; \
	$(SED_INPLACE) "s/\"version\": \"$$current\"/\"version\": \"$$new_version\"/" deno.json; \
	echo "Bumped version from $$current to $$new_version"

# Bump, validate, commit, push, and create the GitHub release.
# Pass VERSION=x.y.z for an explicit version; the default is the next patch.
# Pass PREVIOUS_RELEASE_VERSION=x.y.z to recover from a prior bad release label.
release:
	deno run --allow-read --allow-write --allow-run --allow-env scripts/release.ts $(if $(VERSION),--version $(VERSION),) $(if $(PREVIOUS_RELEASE_VERSION),--previous-release-version $(PREVIOUS_RELEASE_VERSION),)
