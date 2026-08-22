// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Shell tab completion for `dn`.
 *
 * `dn completion bash|zsh` prints a tiny wrapper. The wrapper calls
 * `dn __complete -- <words...>` so command/flag candidates live in TypeScript.
 */

import { AGENT_HARNESSES } from "../sdk/github/agentHarness.ts";
import { RFC_STATUSES } from "../sdk/rfc/types.ts";
import { loadEnsureRecipeNames } from "./ensure.ts";

/** Descriptor for one CLI node (root, subcommand, or nested command). */
export interface CompletionNode {
  /** Nested subcommands keyed by the token the user types. */
  commands?: Record<string, CompletionNode>;
  /** Flags offered when the current token starts with `-`. */
  flags?: string[];
  /**
   * Flags that take a following value. An empty array means "takes a value"
   * but filename completion should handle it.
   */
  flagValues?: Record<string, string[]>;
}

const HELP_FLAGS = ["--help", "-h"];
const BOOTSTRAP_FLAGS = [
  "--unattended",
  "--ci",
  "--no-color",
  "--color",
  "--trace",
  "--no-trace",
];
const SANDBOX_PROVIDERS = ["none", "docker", "exe.dev"];
const PUBLISH_MODES = ["none", "pr", "direct"];
const SKILL_NAMES = ["dn", "base-image", "rfc"];
const SKILL_AGENTS = ["opencode", "cursor", "claude", "codex"];
const ISSUE_STATES = ["open", "closed", "all"];
const CLOSE_REASONS = ["completed", "not_planned"];
const INIT_SCOPES = ["repo", "user"];
const VERBOSITY = ["low", "medium", "high"];
const DISPATCH_MODES = ["repository", "workflow"];

const FILE_VALUE: string[] = [];

function agentWorkflowFlags(): string[] {
  return [
    "--agent",
    "--sandbox",
    "--workspace-root",
    "--steer",
    "--context-file",
    "--allow-cross-repo",
    "-A",
  ];
}

function agentWorkflowFlagValues(): Record<string, string[]> {
  return {
    "--agent": [...AGENT_HARNESSES],
    "--sandbox": SANDBOX_PROVIDERS,
    "--workspace-root": FILE_VALUE,
    "--steer": FILE_VALUE,
    "--context-file": FILE_VALUE,
  };
}

const jsonHelp = ["--json", ...HELP_FLAGS];

const relationshipKind: CompletionNode = {};

const relationshipMutate: CompletionNode = {
  commands: {
    "blocked-by": relationshipKind,
    "sub-issue": relationshipKind,
  },
  flags: ["--repo", ...jsonHelp],
  flagValues: { "--repo": FILE_VALUE },
};

const issueListNode: CompletionNode = {
  flags: ["--state", "--label", "--limit", "--repo", ...jsonHelp],
  flagValues: {
    "--state": ISSUE_STATES,
    "--label": FILE_VALUE,
    "--limit": FILE_VALUE,
    "--repo": FILE_VALUE,
  },
};

const issueShowNode: CompletionNode = {
  flags: ["--no-comments", "--repo", ...jsonHelp],
  flagValues: { "--repo": FILE_VALUE },
};

const issueCreateNode: CompletionNode = {
  flags: [
    "--title",
    "--body",
    "--body-file",
    "--body-stdin",
    "--label",
    "--repo",
    ...jsonHelp,
  ],
  flagValues: {
    "--title": FILE_VALUE,
    "--body": FILE_VALUE,
    "--body-file": FILE_VALUE,
    "--label": FILE_VALUE,
    "--repo": FILE_VALUE,
  },
};

const issueEditNode: CompletionNode = {
  flags: [
    "--title",
    "--body",
    "--body-file",
    "--body-stdin",
    "--add-label",
    "--repo",
    ...jsonHelp,
  ],
  flagValues: {
    "--title": FILE_VALUE,
    "--body": FILE_VALUE,
    "--body-file": FILE_VALUE,
    "--add-label": FILE_VALUE,
    "--repo": FILE_VALUE,
  },
};

const issueRelationshipNode: CompletionNode = {
  flags: ["--repo", ...jsonHelp],
  flagValues: { "--repo": FILE_VALUE },
  commands: {
    list: {
      flags: ["--repo", ...jsonHelp],
      flagValues: { "--repo": FILE_VALUE },
    },
    add: relationshipMutate,
    remove: relationshipMutate,
    reprioritize: {
      flags: ["--repo", ...jsonHelp],
      flagValues: { "--repo": FILE_VALUE },
    },
    "mark-duplicate": {
      flags: ["--repo", ...jsonHelp],
      flagValues: { "--repo": FILE_VALUE },
    },
  },
};

const issueNode: CompletionNode = {
  flags: ["--repo", ...jsonHelp],
  flagValues: { "--repo": FILE_VALUE },
  commands: {
    list: issueListNode,
    ls: issueListNode,
    show: issueShowNode,
    view: issueShowNode,
    create: issueCreateNode,
    new: issueCreateNode,
    edit: issueEditNode,
    update: issueEditNode,
    close: {
      flags: ["--comment", "--reason", "--repo", ...jsonHelp],
      flagValues: {
        "--comment": FILE_VALUE,
        "--reason": CLOSE_REASONS,
        "--repo": FILE_VALUE,
      },
    },
    reopen: {
      flags: ["--comment", "--repo", ...jsonHelp],
      flagValues: { "--comment": FILE_VALUE, "--repo": FILE_VALUE },
    },
    comment: {
      flags: ["--body", "--body-file", "--body-stdin", "--repo", ...jsonHelp],
      flagValues: {
        "--body": FILE_VALUE,
        "--body-file": FILE_VALUE,
        "--repo": FILE_VALUE,
      },
    },
    relationship: issueRelationshipNode,
    relationships: issueRelationshipNode,
  },
};

const releaseCreateNode: CompletionNode = {
  flags: [
    "--target",
    "--title",
    "-t",
    "--notes",
    "-n",
    "--notes-file",
    "-F",
    "--generate-notes",
    "--notes-start-tag",
    "--draft",
    "-d",
    "--prerelease",
    "-p",
    "--latest",
    "--verify-tag",
    "--discussion-category",
    "-R",
    ...HELP_FLAGS,
  ],
  flagValues: {
    "--target": FILE_VALUE,
    "--title": FILE_VALUE,
    "-t": FILE_VALUE,
    "--notes": FILE_VALUE,
    "-n": FILE_VALUE,
    "--notes-file": FILE_VALUE,
    "-F": FILE_VALUE,
    "--notes-start-tag": FILE_VALUE,
    "--discussion-category": FILE_VALUE,
    "-R": FILE_VALUE,
  },
};

const releaseListNode: CompletionNode = {
  flags: ["--limit", ...jsonHelp],
  flagValues: { "--limit": FILE_VALUE },
};

const releaseViewNode: CompletionNode = {
  flags: jsonHelp,
};

const releaseEditNode: CompletionNode = {
  flags: [
    "--title",
    "--notes",
    "--notes-file",
    "--draft",
    "-d",
    "--prerelease",
    "-p",
    ...jsonHelp,
  ],
  flagValues: {
    "--title": FILE_VALUE,
    "--notes": FILE_VALUE,
    "--notes-file": FILE_VALUE,
  },
};

const releaseDeleteNode: CompletionNode = {
  flags: jsonHelp,
};

const releaseNode: CompletionNode = {
  commands: {
    create: releaseCreateNode,
    new: releaseCreateNode,
    list: releaseListNode,
    ls: releaseListNode,
    view: releaseViewNode,
    show: releaseViewNode,
    edit: releaseEditNode,
    update: releaseEditNode,
    delete: releaseDeleteNode,
    rm: releaseDeleteNode,
  },
};

const rfcStatusValues = [...RFC_STATUSES];

const rfcNode: CompletionNode = {
  commands: {
    init: { flags: HELP_FLAGS },
    create: {
      flags: ["--title", "--slug", "--github-issue", ...HELP_FLAGS],
      flagValues: {
        "--title": FILE_VALUE,
        "--slug": FILE_VALUE,
        "--github-issue": FILE_VALUE,
      },
    },
    list: {
      flags: ["--status", ...jsonHelp],
      flagValues: { "--status": rfcStatusValues },
    },
    show: { flags: HELP_FLAGS },
    status: { flags: HELP_FLAGS },
    complete: { flags: HELP_FLAGS },
  },
};

/** Full `dn` command tree used by the completer. */
export const DN_COMPLETION_ROOT: CompletionNode = {
  flags: [
    "--agent",
    "--sandbox",
    "--context-file",
    "--version",
    "-V",
    ...BOOTSTRAP_FLAGS,
    ...HELP_FLAGS,
  ],
  flagValues: {
    "--agent": [...AGENT_HARNESSES],
    "--sandbox": SANDBOX_PROVIDERS,
    "--context-file": FILE_VALUE,
  },
  commands: {
    auth: { flags: HELP_FLAGS },
    completion: {
      commands: {
        bash: {},
        zsh: {},
      },
      flags: HELP_FLAGS,
    },
    context: {
      commands: {
        check: {
          flags: [
            "--json",
            "--claude-tokens",
            "--claude-model",
            "--max-bytes",
            ...HELP_FLAGS,
          ],
          flagValues: {
            "--claude-model": FILE_VALUE,
            "--max-bytes": FILE_VALUE,
          },
        },
      },
      flags: HELP_FLAGS,
    },
    init: {
      flags: HELP_FLAGS,
      commands: {
        stack: {
          flags: [
            "--refresh",
            "--overwrite",
            "--yes",
            "-y",
            "--publish",
            "--agent",
            ...HELP_FLAGS,
          ],
          flagValues: {
            "--publish": PUBLISH_MODES,
            "--agent": [...AGENT_HARNESSES],
          },
        },
        build: {
          flags: ["--agent", "--dry-run", ...jsonHelp],
          flagValues: { "--agent": [...AGENT_HARNESSES] },
        },
        workflows: {
          flags: ["--agent", "--dry-run", ...jsonHelp],
          flagValues: { "--agent": [...AGENT_HARNESSES] },
        },
        agents: {
          flags: [
            "--skill",
            "--agent",
            "--scope",
            "--dry-run",
            "--force",
            ...jsonHelp,
          ],
          flagValues: {
            "--skill": SKILL_NAMES,
            "--agent": SKILL_AGENTS,
            "--scope": INIT_SCOPES,
          },
        },
        wizard: {
          flags: ["--user", "--project", "--yes", "-y", ...jsonHelp],
        },
      },
    },
    issue: issueNode,
    issues: issueNode,
    workflows: {
      flags: ["--agent", "--dry-run", ...jsonHelp],
      flagValues: { "--agent": [...AGENT_HARNESSES] },
      commands: {
        dispatch: {
          flags: [
            "--repo",
            "-R",
            "--ref",
            "-r",
            "--dispatch",
            "--wait",
            "--raw-field",
            "-f",
            "--field",
            "-F",
            ...jsonHelp,
          ],
          flagValues: {
            "--repo": FILE_VALUE,
            "-R": FILE_VALUE,
            "--ref": FILE_VALUE,
            "-r": FILE_VALUE,
            "--dispatch": DISPATCH_MODES,
            "--raw-field": FILE_VALUE,
            "-f": FILE_VALUE,
            "--field": FILE_VALUE,
            "-F": FILE_VALUE,
          },
        },
        exec: { flags: ["--validate-only", ...HELP_FLAGS] },
        list: { flags: jsonHelp },
        install: {
          flags: ["--agent", "--dry-run", ...jsonHelp],
          flagValues: { "--agent": [...AGENT_HARNESSES] },
        },
        update: {
          flags: ["--agent", "--dry-run", ...jsonHelp],
          flagValues: { "--agent": [...AGENT_HARNESSES] },
        },
        validate: { flags: jsonHelp },
      },
    },
    kickstart: {
      flags: [
        "--awp",
        "--publish",
        "--cursor-cloud",
        "--ref",
        "--complete",
        "--once",
        "--saved-plan",
        "--milestone",
        "--denoise-task",
        "--verbosity",
        "--skip-plan",
        ...agentWorkflowFlags(),
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--publish": PUBLISH_MODES,
        "--ref": FILE_VALUE,
        "--saved-plan": FILE_VALUE,
        "--milestone": FILE_VALUE,
        "--denoise-task": FILE_VALUE,
        "--verbosity": VERBOSITY,
        ...agentWorkflowFlagValues(),
      },
    },
    loop: {
      flags: [
        "--plan-file",
        "--cursor-cloud",
        "--ref",
        ...agentWorkflowFlags(),
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--plan-file": FILE_VALUE,
        "--ref": FILE_VALUE,
        ...agentWorkflowFlagValues(),
      },
    },
    until: {
      flags: HELP_FLAGS,
      commands: {
        validate: { flags: HELP_FLAGS },
        run: {
          flags: [
            "--once",
            "--strict-verdict",
            ...agentWorkflowFlags(),
            ...HELP_FLAGS,
          ],
          flagValues: agentWorkflowFlagValues(),
        },
      },
    },
    ensure: {
      flags: [
        "--no-fix",
        "--workspace-root",
        ...agentWorkflowFlags(),
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--workspace-root": FILE_VALUE,
        ...agentWorkflowFlagValues(),
      },
    },
    fixup: {
      flags: [
        "--agent",
        "--workspace-root",
        "--context-file",
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--agent": [...AGENT_HARNESSES],
        "--workspace-root": FILE_VALUE,
        "--context-file": FILE_VALUE,
      },
    },
    meld: {
      flags: [
        "--list",
        "-l",
        "--output",
        "-o",
        "--plan-name",
        "--target",
        "--issue-url",
        "--update-issue",
        "--fill-template",
        "--milestone",
        "-m",
        "--overwrite",
        "--dry-run",
        "--yes",
        "-y",
        ...agentWorkflowFlags(),
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--list": FILE_VALUE,
        "-l": FILE_VALUE,
        "--output": FILE_VALUE,
        "-o": FILE_VALUE,
        "--plan-name": FILE_VALUE,
        "--target": FILE_VALUE,
        "--issue-url": FILE_VALUE,
        "--milestone": FILE_VALUE,
        "-m": FILE_VALUE,
        ...agentWorkflowFlagValues(),
      },
    },
    land: {
      flags: [
        "--single",
        "--dry-run",
        "--issue-testplan",
        "--test-plan",
        "--workspace-root",
        "--context-file",
        "--agent",
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--test-plan": FILE_VALUE,
        "--workspace-root": FILE_VALUE,
        "--context-file": FILE_VALUE,
        "--agent": [...AGENT_HARNESSES],
      },
    },
    peek: {
      flags: [
        "--compact",
        "--no-urls",
        "--verbose",
        "-v",
        "--limit",
        "-n",
        "--fetch",
        ...HELP_FLAGS,
      ],
      flagValues: {
        "--limit": FILE_VALUE,
        "-n": FILE_VALUE,
        "--fetch": FILE_VALUE,
      },
    },
    glance: {
      flags: [
        "--compact",
        "--no-urls",
        "--json",
        "--days",
        "-d",
        ...HELP_FLAGS,
      ],
      flagValues: { "--days": FILE_VALUE, "-d": FILE_VALUE },
    },
    task: {
      flags: HELP_FLAGS,
      commands: {
        list: { flags: jsonHelp },
        show: { flags: jsonHelp },
        upsert: {
          flags: ["--file", "--stdin", ...HELP_FLAGS],
          flagValues: { "--file": FILE_VALUE },
        },
        delete: { flags: HELP_FLAGS },
      },
    },
    todo: {
      flags: HELP_FLAGS,
      commands: {
        done: {
          flags: ["--comment", ...HELP_FLAGS],
          flagValues: { "--comment": FILE_VALUE },
        },
      },
    },
    tidy: {
      flags: ["--limit", "--agent", ...HELP_FLAGS],
      flagValues: {
        "--limit": FILE_VALUE,
        "--agent": [...AGENT_HARNESSES],
      },
    },
    sync: {
      flags: ["--workspace-root", "--skip-preflight", ...HELP_FLAGS],
      flagValues: { "--workspace-root": FILE_VALUE },
    },
    runner: {
      flags: HELP_FLAGS,
      commands: {
        connect: {
          flags: [
            "--name",
            "--api-url",
            "--install",
            "--repo",
            "--no-open",
            ...jsonHelp,
          ],
          flagValues: {
            "--name": FILE_VALUE,
            "--api-url": FILE_VALUE,
          },
        },
        register: {
          flags: ["--yes", ...jsonHelp],
        },
        unregister: { flags: jsonHelp },
        doctor: { flags: jsonHelp },
        status: { flags: jsonHelp },
        jobs: { flags: jsonHelp },
        kickstart: {
          flags: ["--publish", "--denoise-task", "--wait", ...jsonHelp],
          flagValues: {
            "--publish": PUBLISH_MODES,
            "--denoise-task": FILE_VALUE,
          },
        },
        pause: { flags: jsonHelp },
        resume: { flags: jsonHelp },
        install: { flags: HELP_FLAGS },
        start: { flags: jsonHelp },
        stop: { flags: jsonHelp },
        serve: { flags: ["--once", ...HELP_FLAGS] },
        disconnect: { flags: jsonHelp },
        rotate: { flags: jsonHelp },
      },
    },
    release: releaseNode,
    releases: releaseNode,
    rfc: rfcNode,
    help: {},
  },
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function filterPrefix(candidates: string[], prefix: string): string[] {
  return uniqueSorted(candidates.filter((value) => value.startsWith(prefix)));
}

function flagName(token: string): string {
  const equals = token.indexOf("=");
  return equals === -1 ? token : token.slice(0, equals);
}

function nodeFlags(node: CompletionNode): string[] {
  return uniqueSorted([
    ...BOOTSTRAP_FLAGS,
    ...HELP_FLAGS,
    ...(node.flags ?? []),
  ]);
}

function valueOptions(
  node: CompletionNode,
  flag: string,
): string[] | undefined {
  const values = node.flagValues;
  if (!values || !Object.hasOwn(values, flag)) {
    return undefined;
  }
  return values[flag];
}

function takesValue(node: CompletionNode, flag: string): boolean {
  return valueOptions(node, flag) !== undefined;
}

/**
 * Returns completion candidates for a shell word list.
 *
 * `words[0]` is the program name (`dn` or a path to it). The last word is the
 * prefix being completed; use an empty string after a trailing space.
 */
export function completeWords(
  words: string[],
  root: CompletionNode = DN_COMPLETION_ROOT,
  extra: { ensureRecipes?: readonly string[] } = {},
): string[] {
  if (words.length === 0) {
    return [];
  }

  const rest = words.slice(1);
  const prefix = rest.length > 0 ? rest[rest.length - 1] ?? "" : "";
  const tokens = rest.length > 0 ? rest.slice(0, -1) : [];

  let node = root;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (token === "--") {
      return [];
    }
    if (token.startsWith("-")) {
      const name = flagName(token);
      if (token.includes("=")) {
        index++;
        continue;
      }
      const next = tokens[index + 1];
      if (
        takesValue(node, name) &&
        next !== undefined &&
        !next.startsWith("-")
      ) {
        index += 2;
        continue;
      }
      index++;
      continue;
    }
    const child = node.commands?.[token];
    if (child) {
      node = child;
      index++;
      continue;
    }
    break;
  }

  if (prefix.includes("=")) {
    const name = flagName(prefix);
    const valuePrefix = prefix.slice(name.length + 1);
    const options = valueOptions(node, name);
    if (!options || options.length === 0) {
      return [];
    }
    return filterPrefix(options, valuePrefix).map((value) =>
      `${name}=${value}`
    );
  }

  const previous = tokens[tokens.length - 1];
  if (
    previous &&
    previous.startsWith("-") &&
    !previous.includes("=") &&
    takesValue(node, flagName(previous)) &&
    !prefix.startsWith("-")
  ) {
    const options = valueOptions(node, flagName(previous)) ?? [];
    if (options.length === 0) {
      return [];
    }
    return filterPrefix(options, prefix);
  }

  if (prefix.startsWith("-")) {
    return filterPrefix(nodeFlags(node), prefix);
  }

  const commandMatches = node.commands
    ? filterPrefix(Object.keys(node.commands), prefix)
    : [];
  if (
    extra.ensureRecipes &&
    extra.ensureRecipes.length > 0 &&
    node === root.commands?.ensure &&
    !prefix.startsWith("-")
  ) {
    const recipeMatches = filterPrefix([...extra.ensureRecipes], prefix);
    return [...new Set([...commandMatches, ...recipeMatches])].sort();
  }
  return commandMatches;
}

/** Bash wrapper registered with `complete -F`. */
export function bashCompletionScript(): string {
  return `# dn bash completion
# Add to ~/.bashrc:
#   eval "$(dn completion bash)"

_dn() {
  local cur="\${COMP_WORDS[COMP_CWORD]-}"
  local cmd="\${1:-dn}"
  local -a words
  words=("\${COMP_WORDS[@]}")
  if (( COMP_CWORD >= \${#words[@]} )); then
    words+=("")
  else
    words[COMP_CWORD]="$cur"
  fi
  local out
  out="$("$cmd" __complete -- "\${words[@]}" 2>/dev/null)" || out=""
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "\${out}" -- "$cur"))
}

complete -o default -F _dn dn
`;
}

/** Zsh wrapper registered with `compdef`. */
export function zshCompletionScript(): string {
  return `#compdef dn
# dn zsh completion
# Add to ~/.zshrc after compinit:
#   eval "$(dn completion zsh)"

_dn() {
  local cmd="\${words[1]}"
  integer n=\${#words}
  if (( CURRENT > n )); then
    words+=""
  fi
  local out
  out="$("$cmd" __complete -- "\${words[@]}" 2>/dev/null)" || out=""
  if [[ -z "$out" ]]; then
    _files
    return 0
  fi
  local -a completions
  completions=(\${(f)out})
  _describe 'dn' completions
}

compdef _dn dn
`;
}

function printCompletionHelp(): void {
  console.log("dn completion - Print shell completion scripts\n");
  console.log("Usage:");
  console.log("  dn completion <bash|zsh>\n");
  console.log("Enable tab completion from your shell rc:\n");
  console.log("  # ~/.bashrc");
  console.log('  eval "$(dn completion bash)"\n');
  console.log("  # ~/.zshrc (after compinit)");
  console.log('  eval "$(dn completion zsh)"\n');
  console.log("Completes subcommands, nested commands, and known flags.");
  console.log("Positional paths use the shell's filename completion.");
}

/**
 * Handles `dn completion bash|zsh`.
 */
export function handleCompletion(args: string[]): void {
  const shell = args[0];
  if (shell === "--help" || shell === "-h") {
    printCompletionHelp();
    return;
  }
  if (shell === "bash") {
    console.log(bashCompletionScript());
    return;
  }
  if (shell === "zsh") {
    console.log(zshCompletionScript());
    return;
  }
  printCompletionHelp();
  if (shell) {
    console.error(`Unsupported shell: ${shell}. Use bash or zsh.`);
  }
  Deno.exit(1);
}

/**
 * Handles hidden `dn __complete -- <words...>`.
 *
 * Always succeeds: a failing completer breaks Tab in the shell.
 */
export function handleComplete(args: string[]): void {
  try {
    const words = args[0] === "--" ? args.slice(1) : args;
    const ensureRecipes = loadEnsureRecipeNames(Deno.cwd());
    for (
      const candidate of completeWords(words, DN_COMPLETION_ROOT, {
        ensureRecipes,
      })
    ) {
      console.log(candidate);
    }
  } catch {
    // Completers must stay silent.
  }
}
