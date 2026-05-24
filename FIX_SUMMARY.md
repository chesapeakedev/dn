# Fix Summary: dn init stack workflow

## Problem
The workflow was failing with "`dn: command not found`" even though the dn-action had successfully downloaded and installed the dn binary.

## Root Cause
The workflow was trying to execute `dn` directly, assuming it would be in the PATH. However, the dn-action installs the binary to a specific location (typically `$HOME/.local/bin/dn-linux-x64`) and only adds that directory to the PATH for subsequent steps via the `$GITHUB_PATH` file. 

In this workflow, the `run` step was executing in a new shell context where the PATH modification from the previous step wasn't automatically available.

## Solution
Modified the workflow to:
1. Added an `id: dn-install` to the Install dn step to capture its outputs
2. Used the `dn-path` output from that step to explicitly call the binary at its installed location: `"${{ steps.dn-install.outputs.dn-path }}"`

## Changes Made
Updated `.github/workflows/dn-init-stack.yml`:
- Added `id: dn-install` to the Install dn step (line 42)
- Changed the final command from `dn $AGENT_ARG init stack ...` to `"${{ steps.dn-install.outputs.dn-path }}" $AGENT_ARG init stack ...` (line 62)

This ensures we're calling the dn binary at its actual installed location rather than relying on it being in the PATH.