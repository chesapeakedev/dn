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
#   - dn CLI (compiled from this repository)
#   - opencode (agent harness)

FROM denoland/deno:debian-2.6.3

ARG OPENCODE_VERSION=1.17.13

LABEL org.opencontainers.image.source="https://github.com/chesapeakedev/dn"
LABEL org.opencontainers.image.description="dn kickstart sandbox runtime"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git bash curl ca-certificates tar \
  && rm -rf /var/lib/apt/lists/*

# Install opencode agent harness
RUN curl -fsSL https://opencode.ai/install \
  | bash -s -- --version "$OPENCODE_VERSION" --no-modify-path \
  && ln -s /root/.opencode/bin/opencode /usr/local/bin/opencode \
  && opencode --version

# Build dn CLI from repository sources
COPY deno.json deno.lock /opt/dn/
COPY cli /opt/dn/cli
COPY glance /opt/dn/glance
COPY kickstart /opt/dn/kickstart
COPY sdk /opt/dn/sdk
WORKDIR /opt/dn
RUN deno compile -A --output /usr/local/bin/dn cli/main.ts

ENV WORKSPACE_ROOT=/workspace
WORKDIR /workspace

ENTRYPOINT ["sleep", "infinity"]
