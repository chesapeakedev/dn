# Making Kickstart Faster by Self-Hosting

This document describes how to set up a self-hosted GitHub Actions runner on
Debian-based Linux distributions (Ubuntu, Pop!\_OS) to run Kickstart workflows
on your own hardware.

## Overview

Self-hosted runners let you run GitHub Actions workflows on your own
infrastructure—useful for workflows that need specific hardware or software,
compute-intensive jobs, control over the execution environment, or access to
private resources. Running Kickstart on your own hardware reduces queue time and
gives you full control. The instructions below work across Debian-based
distributions and are suitable for long-running, always-on runners.

## Hardware Requirements

- **CPU**: 2+ cores recommended
- **RAM**: 4GB minimum (8GB+ recommended for AI agent workloads)
- **Disk**: 50GB+ free space
- **Network**: Stable outbound HTTPS access to GitHub

## Prerequisites

- Ubuntu Linux (20.04 LTS or later recommended)
- Root or sudo access
- Network connectivity to GitHub

## Installation Steps

### 1. System Preparation

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y \
  curl \
  git \
  build-essential \
  unzip \
  jq \
  ca-certificates
```

### 2. Create Runner User (Recommended)

Create a dedicated user for the runner to improve security:

```bash
sudo useradd -m -s /bin/bash github-runner
sudo su - github-runner
```

### 3. Install Deno

Kickstart workflows require Deno.

```bash
curl -fsSL https://deno.land/install.sh | sh
export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
deno --version
```

Reference: https://docs.deno.com/runtime/getting_started/installation/

### 4. Install opencode

```bash
curl -fsSL https://opencode.dev/install | bash
export PATH="$HOME/.opencode/bin:$PATH"
opencode --version
```

Reference: https://opencode.dev/docs/installation

### 5. Download and Configure Runner

Check https://github.com/actions/runner/releases for the current version and
filename. Download and extract (update the version in the URL if needed):

```bash
mkdir actions-runner && cd actions-runner
curl -L -o actions-runner-linux-x64.tar.gz https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz
```

Configure the runner for your repository or organization:

```bash
./config.sh --url https://github.com/OWNER/REPO --token RUNNER_TOKEN
```

For organization-level runner:

```bash
./config.sh --url https://github.com/OWNER --token RUNNER_TOKEN
```

Replace:

- `OWNER` with your GitHub username or organization name
- `REPO` with your repository name (for repo-level)
- `RUNNER_TOKEN` with the token from GitHub (Settings → Actions → Runners → New
  self-hosted runner)

### 6. Install Runner Service

```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

### 7. Configure Environment Variables

For the systemd service, create
`/etc/systemd/system/actions.runner.*.service.d/override.conf`:

```ini
[Service]
Environment="DENO_INSTALL=/home/github-runner/.deno"
Environment="PATH=/home/github-runner/.deno/bin:/home/github-runner/.opencode/bin:/home/github-runner/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Environment="GITHUB_TOKEN=your-github-pat-here"
```

Optional API keys:

```ini
Environment="OPENAI_API_KEY=sk-..."
Environment="ANTHROPIC_API_KEY=sk-ant-..."
```

Reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart actions.runner.*.service
```

## Configuration

### Runner Labels

```bash
./config.sh --url https://github.com/OWNER/REPO --token TOKEN --labels self-hosted,linux,ubuntu
```

### Runner Groups

1. Go to Settings → Actions → Runner groups
2. Create a new group
3. Assign runners to groups

### Workflow Configuration

**Security**

- **Firewall**: Only allow outbound HTTPS connections to `github.com` and
  `api.github.com`
- **VPN**: Consider using a VPN for additional security
- **Isolation**: Run runners in isolated network segments when possible
- **User Permissions**: Use a dedicated user with minimal privileges
- **File Permissions**: Restrict access to runner directories
- **Token Management**: Store tokens securely and rotate regularly
- **Auto-updates**: Enable automatic runner updates
- **Monitoring**: Monitor runner logs for suspicious activity
- **Cleanup**: Regularly clean up workspace directories

**Workflow YAML**

Update workflows to use self-hosted runners:

```yaml
jobs:
  kickstart:
    runs-on: [self-hosted, linux, x64, kickstart]
    steps:
      - uses: actions/checkout@v4
      - name: Run kickstart
        run: deno run --allow-all cli/main.ts kickstart --awp "${{ github.event.inputs.issue_url }}"
```

## Maintenance

### Update Runner

The runner auto-updates when a new version is available. For manual update,
check https://github.com/actions/runner/releases for the current version and
filename, then:

```bash
cd actions-runner
./svc.sh stop
curl -L -o actions-runner-linux-x64.tar.gz https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64.tar.gz
./svc.sh start
```

### Monitor Runner

```bash
sudo systemctl status actions.runner.*.service
```

```bash
sudo journalctl -u actions.runner.*.service -f
tail -f ~/actions-runner/_diag/Runner_*.log
```

### Cleanup Workspaces

Add to crontab for periodic cleanup:

```bash
0 2 * * * find ~/actions-runner/_work -type d -mtime +7 -exec rm -rf {} +
```

## Troubleshooting

### Runner Not Connecting

1. Check network connectivity: `curl https://github.com`
2. Verify token is valid and not expired
3. Check firewall rules
4. Review runner logs: `~/actions-runner/_diag/Runner_*.log`

### Dependencies Not Found

1. Verify PATH includes dependency directories
2. Check environment variables are set correctly
3. Restart runner service after installing dependencies
4. Test commands manually: `deno --version`, `opencode --version`

### Permission Issues

1. Verify runner user has necessary permissions
2. Check file ownership: `ls -la ~/actions-runner`
3. Ensure workspace directory is writable

## Security Considerations

- Use a dedicated `github-runner` user
- Never commit tokens; restrict permissions on `~/.runner-env`
- Keep runner, Deno, and opencode up to date
- Consider firewall rules limiting outbound traffic

## References

- [GitHub Actions: About self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/about-self-hosted-runners)
- [GitHub Actions: Adding self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/adding-self-hosted-runners)
- [GitHub Actions: Configuring self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/configuring-the-self-hosted-runner-application-as-a-service)
- [GitHub Actions: Security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)

## Additional Resources

- [Deno Installation](https://deno.land/manual/getting_started/installation)
- [opencode Installation](https://opencode.dev/docs/installation)
- [Cursor CLI Installation](https://cursor.com/docs/cli/installation)
