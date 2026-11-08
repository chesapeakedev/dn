# Workspace CLI (`dn task`, `dn milestone`)

`dn task` and `dn milestone` are the unified CLI for work tracking in three
places: your local kickstart queue (Denoise Personal / Void), GitHub issues, and
Denoise Pro cloud milestones and tasks. Agents installed via
`dn init agents --skill dn` document these backends in the dn skill.

`dn task` and `dn milestone` can target three backends:

| Backend   | Flag                | Use case                           |
| --------- | ------------------- | ---------------------------------- |
| `todo`    | `--todo` (default)  | Local `~/.dn/todo.md` queue        |
| `github`  | `--github` / `--gh` | Same as `dn issue`                 |
| `denoise` | `--denoise`         | Denoise cloud milestones and tasks |

Set a default in project `dn.json` or `~/.dn/config.json`:

```json
{
  "workspace": {
    "default_backend": "denoise",
    "api_url": "https://denoise.cloud"
  }
}
```

`tasks.default_backend` is accepted as a deprecated alias.

## Authentication

Denoise operations use `resolveGitHubToken()` (`GITHUB_TOKEN`, `gh auth token`,
or `dn auth` cache). Sign into Denoise in the browser once so GitHub maps to a
Denoise user.

## Examples

```bash
dn milestone create --denoise --title "Sprint A"
dn task create --denoise --milestone <uuid> --title "Implement API" --body-file spec.md
dn task show --denoise https://denoise.cloud/task/<uuid>
dn kickstart https://denoise.cloud/task/<uuid>
```

QA bulk load:

```bash
dn task create --denoise --milestone "$ID" --count 50 --title-prefix "Load"
```
