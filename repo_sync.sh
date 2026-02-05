#!/bin/bash
# sync your local sapling stack with upstream

# good debuggable default for bash
set -e

# pass lint before interacting with upstream
make lint 

# rebase upstream over local
sl pull --rebase -d main 

# check if there are any local commits that need to be restacked and pushed
#
# only restack and push when there are draft commits on the stack above
# main (draft() & ancestors(.) & descendants(main)). Side-branch drafts are
# ignored so they don't trigger restack/push.
draft_on_main=$(sl log --rev "draft() & ancestors(.) & descendants(main)" -T "{node}\n" 2>/dev/null | head -1)
if [ -n "$draft_on_main" ]; then
  sl push --to main
fi
