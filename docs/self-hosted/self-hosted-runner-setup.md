# Making Kickstart Faster by Self-Hosting

This document describes how to set up a self-hosted GitHub Actions runner on Debian-based Linux distributions (Ubuntu, Pop!\_OS) to run Kickstart workflows on your own hardware.

## Introduction & Use Case

Self-hosted runners allow you to run GitHub Actions workflows on your own
infrastructure. This can be useful for:

- Running workflows that require specific hardware or software
- Reducing costs for compute-intensive workflows
- Maintaining control over the execution environment
- Running workflows that need access to private resources

## Overview

Self-hosted runners allow Kickstart to run closer to your hardware, reducing queue time and giving you full control over the execution environment. The instructions below are generic across Debian-based distributions and are suitable for long-running, always-on runners.

## Hardware Requirements

- **CPU**: 2+ cores recommended
- **RAM**: 4GB minimum (8GB+ recommended for AI agent workloads)
- **Disk**: 50GB+ free space
- **Network**: Stable outbound HTTPS access to GitHub

## Prerequisites

- Ubuntu Linux (20.04 LTS or later recommended)
- Root or sudo access
- Network connectivity to GitHub
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

Download the latest runner package:

```bash
# Create a folder
mkdir actions-runner && cd actions-runner

# Download the latest runner package (check releases for newest version)
curl -o actions-runner-linux-x64.tar.gz -L https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz

# Extract the installer
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz
```

### 6. Configure Runner

Configure the runner for your repository or organization:

```bash
# For repository-level runner
./config.sh --url https://github.com/OWNER/REPO --token RUNNER_TOKEN

# For organization-level runner
./config.sh --url https://github.com/OWNER --token RUNNER_TOKEN
```

Replace:

- `OWNER` with your GitHub username or organization name
- `REPO` with your repository name (for repo-level)
- `RUNNER_TOKEN` with the token from GitHub (Settings → Actions → Runners → New
  self-hosted runner)

### 7. Install Runner Service

Install the runner as a systemd service:

```bash
sudo ./svc.sh install
sudo ./svc.sh start
sudo ./svc.sh status
```

### 8. Configure Environment Variables

Install dependencies required by kickstart workflows:

```bash
cat > ~/.runner-env << 'EOF'
export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
export GITHUB_TOKEN="your-github-pat-here"
# Optional:
# export OPENAI_API_KEY="sk-..."
# export ANTHROPIC_API_KEY="sk-ant-..."
EOF

echo 'source ~/.runner-env' >> ~/.bashrc
```

### 6. Configure Environment Variables

Set up required environment variables for the runner user:

```bash
# Add to ~/.bashrc or create ~/.env file
export GITHUB_TOKEN="your-token-here"  # Or use GitHub Actions secrets
```

For systemd service, create
`/etc/systemd/system/actions.runner.*.service.d/override.conf`:

```ini
[Service]
Environment="GITHUB_TOKEN=your-token-here"
Environment="PATH=/home/github-runner/.deno/bin:/home/github-runner/.opencode/bin:/home/github-runner/.cursor/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
```

Then reload systemd:

```bash
sudo systemctl daemon-reload
sudo systemctl restart actions.runner.*.service
```

## Workflow Configuration

### Network Security

- **Firewall**: Only allow outbound HTTPS connections to `github.com` and
  `api.github.com`
- **VPN**: Consider using a VPN for additional security
- **Isolation**: Run runners in isolated network segments when possible

### Access Control

- **User Permissions**: Use a dedicated user with minimal privileges
- **File Permissions**: Restrict access to runner directories
- **Token Management**: Store tokens securely and rotate regularly

### Runner Security

- **Auto-updates**: Enable automatic runner updates
- **Monitoring**: Monitor runner logs for suspicious activity
- **Cleanup**: Regularly clean up workspace directories

## Configuration

### Runner Labels

Add custom labels to identify runner capabilities:

```bash
./config.sh --url https://github.com/OWNER/REPO --token TOKEN --labels self-hosted,linux,ubuntu
```

### Runner Groups

Organize runners into groups for better management:

1. Go to Settings → Actions → Runner groups
2. Create a new group
3. Assign runners to groups

### Workflow Configuration

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

Update the runner to the latest version:

```bash
cd actions-runner
./run.sh
# Runner will auto-update when new version is available
```

Or manually update:

```bash
cd actions-runner
./svc.sh stop
# Download new version
curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
tar xzf ./actions-runner-linux-x64-2.311.0.tar.gz
./svc.sh start
```

### Monitor Runner

Check runner status:

```bash
sudo systemctl status actions.runner.*.service
```

View runner logs:

```bash
# Service logs
sudo journalctl -u actions.runner.*.service -f

# Runner logs
tail -f ~/actions-runner/_diag/Runner_*.log
```

### Cleanup Workspaces

Runners accumulate workspace files. Set up periodic cleanup:

```bash
# Add to crontab
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
