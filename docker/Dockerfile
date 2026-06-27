# Minimal dn-kickstart sandbox image.
#
# Build:
#   docker build -t ghcr.io/chesapeakedev/dn-kickstart:latest -f docker/Dockerfile .
#
# Usage (from repo root):
#   docker run --rm -it -v $(pwd):/workspace ghcr.io/chesapeakedev/dn-kickstart:latest
#
# The image includes:
#   - Deno runtime
#   - dn CLI (built from workspace)
#   - opencode (agent harness)

FROM denoland/deno:alpine-2.6.3

LABEL org.opencontainers.image.source="https://github.com/chesapeakedev/dn"
LABEL org.opencontainers.image.description="dn kickstart sandbox runtime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Install system dependencies
RUN apk add --no-cache git bash curl

# Install opencode
RUN deno install -g --allow-all --name opencode jsr:@opencode/opencode

# Default workspace mount point
ENV WORKSPACE_ROOT=/workspace
WORKDIR /workspace

# Container stays alive so dn can exec into it
ENTRYPOINT ["sleep", "infinity"]
