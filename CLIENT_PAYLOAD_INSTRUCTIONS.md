# Client Payload Instructions for `dn.init_stack` Workflow

When triggering the `dn.init_stack` workflow via a `repository_dispatch` event, the client must include a `client_payload` object with the following structure:

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `schema_version` | string | Must be exactly `"1.0"` (string, not number) |
| `dispatch_id` | string | A unique identifier for this dispatch (non-empty) |
| `milestone` | string | The milestone identifier (non-empty) |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `refresh` | boolean | If set to `false`, the `--refresh` flag will not be passed to the `dn init stack` command. Defaults to `true` if not provided or set to any value other than `false`. |
| `agent` | string | If provided, the `--agent` flag will be passed with this value to the `dn init stack` command. If empty or not provided, no agent flag is used. |

## Example Payload

```json
{
  "schema_version": "1.0",
  "dispatch_id": "abc123",
  "milestone": "v1.0.0",
  "refresh": true,
  "agent": "my-custom-agent"
}
```

## Common Mistakes

1. **`schema_version` as a number**: The validation expects a string `"1.0"`, not the number `1.0`.
2. **Missing required fields**: All three required fields must be present and non-empty.
3. **Incorrect boolean handling for `refresh`**: The workflow treats any value that is not exactly the boolean `false` as `true` for the refresh flag. To disable refresh, you must explicitly set `refresh: false`.

## Triggering the Workflow

You can trigger this workflow using the GitHub API:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  https://api.github.com/repos/<OWNER>/<REPO>/dispatches \
  -d '{
    "event_type": "dn.init_stack",
    "client_payload": {
      "schema_version": "1.0",
      "dispatch_id": "your-unique-id",
      "milestone": "your-milestone"
    }
  }'
```

Replace `<OWNER>`, `<REPO>`, and `<YOUR_TOKEN>` with your repository details and a personal access token with the required permissions (contents: write, issues: write).