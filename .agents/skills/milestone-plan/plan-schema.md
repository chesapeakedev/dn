# Milestone plan schema

`plans/<slug>.milestone.json` is a declarative input for `dn milestone publish`.
The following describes the artifact shape accepted by the command.

## Top-level fields

- `schema_version`: Must be `"1.0"`.
- `milestone`: Object with a required `title`, plus optional `description` and
  `due_on` values.
- `issues`: Array of issue definitions. Issues are created in array order.

The optional `repo` field selects an `owner/repo`; otherwise `dn` resolves the
repository from the current checkout. Use the filename to carry the plan slug.

## Issue fields

Each issue requires:

- `id`: Optional unique identifier within the artifact. It is required when the
  issue declares `blocked_by` relationships.
- `title`: GitHub issue title.
- `body`: Markdown body. Include `## Acceptance Criteria` and checkbox items.

Optional issue fields are `labels` (an array of label names) and `blocked_by`,
an array of sibling issue `id` values. Dependencies should also be clear in the
issue body when useful.

## Example

See `example.milestone.json`. Keep plans free of access tokens, generated GitHub
IDs, and commands that bypass `dn`.
