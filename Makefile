SHELL := bash

# Detect OS for sed compatibility (macOS uses BSD sed, Linux uses GNU sed)
ifeq ($(shell uname),Darwin)
    SED_INPLACE := sed -i ''
else
    SED_INPLACE := sed -i
endif

# deslop checks
include deslop.mk

.PHONY: \
	fmt \
	lint \
	precommit \
	configure \
	sync \
	compile \
	install \
	kickstart_ci_opencode \
	kickstart_ci_cursor \
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
	bump_patch bump_minor bump_major

fmt: ; deno fmt
lint: fmt ; deno task typecheck && deno task lint
precommit: ; deno task precommit
# NOTE: We use --allow-env instead of --allow-env=NODE_ENV because npm packages
# like graphql access process.env.NODE_ENV at module load time. Deno's scoped
# env permissions don't work correctly with npm packages - the graphql package
# checks `process.env.NODE_ENV === 'production'` at import time, which throws
# NotCapable even with --allow-env=NODE_ENV. See: denoland/deno#28125
tests: ; NODE_ENV=dev deno test --allow-run --allow-env
configure: install
publish: ; deno task publish
# sync your local changes with trunk, rebasing trunk under your work
# leaves branches alone
sync: ./repo_sync.sh
	$(SHELL) ./repo_sync.sh

# compile & install dn locally for the current user
TARGET_DIR=~/.local/bin
compile: ; @bash ./compile_dn.sh
install: compile
	@mkdir -p $(TARGET_DIR)
	@cp "./.dn" $(TARGET_DIR)/dn
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
