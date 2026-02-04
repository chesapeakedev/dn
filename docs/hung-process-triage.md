# Hung Process Triage on macOS

FIXME: integrate the advice of this document into @CONTRIBUTING.md and delete this file

This document describes tools and techniques for debugging hung processes on
macOS.

## 1. Activity Monitor (GUI)

- Open **Activity Monitor** (Applications → Utilities)
- Find the process (e.g., `kickstart` or `deno`)
- Check **CPU**, **Memory**, and **Threads** tabs
- Use **"Inspect Process"** to see open files and network connections

## 2. `lsof` - List Open Files

Shows what files, sockets, and resources the process has open:

```bash
# Find the process ID first
ps aux | grep kickstart

# Then list all open files/sockets for that PID
lsof -p <PID>

# Or in one command:
lsof -p $(pgrep -f kickstart)
```

**Look for:**

- Open network connections (the fetch calls)
- File handles that aren't closed
- Pipes or sockets

## 3. `sample` - Process Sampling

Captures a stack trace of what the process is doing:

```bash
# Sample for 10 seconds
sample <PID> 10

# Or find and sample in one go
sample $(pgrep -f kickstart) 10
```

This shows where the process is stuck (function calls, waiting on I/O, etc.).

## 4. `dtrace` / `dtruss` - System Call Tracing

Shows system calls the process is making:

```bash
# Trace system calls (requires sudo)
sudo dtruss -p <PID>

# Or trace a specific process from start
sudo dtruss -f ./kickstart <issue_url>
```

**Look for:**

- `select()`, `poll()`, `kevent()` calls (waiting on I/O)
- Network calls that never return
- File operations that hang

## 5. `strace` (if installed via Homebrew)

Similar to dtruss but Linux-style:

```bash
brew install strace
strace -p <PID>
```

## 6. `vmmap` - Memory Map

Shows memory regions and what's mapped:

```bash
vmmap <PID>
```

## 7. `fs_usage` - File System Activity

Shows real-time file system operations:

```bash
sudo fs_usage -w -f filesys <PID>
```

## 8. Network Monitoring

Check if network calls are hanging:

```bash
# Show network connections
netstat -an | grep <PID>

# Or use lsof for network
lsof -i -p <PID>
```

## Quick Debugging Script

Here's a one-liner to get comprehensive info:

```bash
PID=$(pgrep -f kickstart | head -1)
echo "=== Process Info ==="
ps -p $PID -o pid,ppid,command,etime,state
echo -e "\n=== Open Files/Sockets ==="
lsof -p $PID
echo -e "\n=== Network Connections ==="
lsof -i -p $PID
echo -e "\n=== Sampling (10 seconds) ==="
sample $PID 10
```

## Most Useful for Hung Processes

Given that logs show completion but the process doesn't exit, try these in
order:

1. **`lsof -p <PID>`** - Check for open network connections (the fetch calls)
2. **`sample <PID> 10`** - See the stack trace to identify what it's waiting on
3. **`dtruss -p <PID>`** - See if it's stuck in a system call

The `sample` command is likely the most useful—it shows the call stack and where
execution is stuck.

## Example Workflow

```bash
# 1. Find the process
ps aux | grep kickstart

# 2. Get its PID (let's say it's 12345)
PID=12345

# 3. Check what it has open
lsof -p $PID

# 4. Sample it to see where it's stuck
sample $PID 10 > /tmp/sample-output.txt

# 5. Review the sample output
cat /tmp/sample-output.txt
```

## Notes

- Most of these commands require the process to still be running
- `sample` and `dtruss` may slow down the process slightly
- Network-related hangs often show up as open TCP connections in `lsof`
- If the process is waiting on I/O, `sample` will show it in a `select()` or
  `poll()` call
