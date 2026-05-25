// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

import type { MeldTargetKind } from "./target.ts";

/** Bundled kickstart-relative filename for each {@link MeldTargetKind}'s meld phase. */
export function meldTargetSystemPromptFile(kind: MeldTargetKind): string {
  switch (kind) {
    case "plan":
      return "system.prompt.plan.md";
    case "readme":
      return "system.prompt.meld.readme.md";
    case "contributing":
      return "system.prompt.meld.contributing.md";
    case "agents":
      return "system.prompt.meld.agents.md";
    case "markdown":
      return "system.prompt.meld.markdown.md";
    case "github-issue":
      return "system.prompt.meld.github-issue.md";
    case "github-comment":
      return "system.prompt.meld.github-comment.md";
  }
}
