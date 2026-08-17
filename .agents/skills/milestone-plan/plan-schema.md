# Milestone plan schema

`plans/<slug>.milestone.json` is a declarative input for `dn milestone publish`.
The following describes the required artifact shape.

## Top-level fields

- `schema_version`: Must be `1.0`.
- `slug`: Lowercase, hyphen-separated identifier used in the plan filename.
- `title`: Human-readable milestone title.
- `overview`: Short description of the project's goal and boundaries.
- `issues`: Ordered array of issue definitions. Earlier issues should be
  deliverable before later issues unless dependencies say otherwise.

Optional fields are `repository` (`owner` and `name`), `milestone` (`title` and
optional `description`), and `assumptions`.

## Issue fields

Each issue requires:

- `slug`: Unique issue identifier within the artifact.
- `title`: GitHub issue title.
- `body`: Markdown body. Include `## Acceptance Criteria` and checkbox items.
- `acceptance_criteria`: Non-empty list of the same measurable milestones
  represented in the body.

An issue may include `depends_on`, an array of sibling issue slugs. Dependencies
are planning metadata and should also be clear in the issue body when useful.

## Example

See `example.milestone.json`. Keep plans free of access tokens, generated GitHub
IDs, and commands that bypass `dn`.
