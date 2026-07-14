# Default dn golden image for agent sandboxes.
#
# Contract (required in the final image):
#   - Deno runtime (>= 2.6.3)
#   - dn CLI
#   - Agent harness (opencode by default)
#   - git + bash
#
# Build (from a checkout that includes dn sources, or copy this into
# chesapeakedev/dn-images and adjust COPY paths):
#   docker build -t ghcr.io/OWNER/dn-images:latest -f templates/dn-images/Dockerfile .
#
# Hygiene tips:
#   - Prefer pinning the base by digest:
#       FROM denoland/deno:debian-2.6.3@sha256:<digest>
#     Refresh digests deliberately (crane digest / Renovate), not on every build.
#   - Prefer publishing :sha-<commit> tags and referencing those in
#     sandbox.docker.image for CI reproducibility.
#   - Never bake API keys or SSH private keys into layers.
#
# Related: docker/Dockerfile in the dn repository publishes
# ghcr.io/chesapeakedev/dn-kickstart.

# Pin by tag for readability; replace with @sha256:… for locked rebuilds.
FROM denoland/deno:debian-2.6.3

ARG OPENCODE_VERSION=1.17.13
ARG DN_UID=1000
ARG DN_GID=1000

LABEL org.opencontainers.image.source="https://github.com/chesapeakedev/dn-images"
LABEL org.opencontainers.image.description="dn golden image for Docker sandbox agents"
LABEL org.opencontainers.image.licenses="Apache-2.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends git bash curl ca-certificates tar \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid "$DN_GID" dn \
  && useradd --uid "$DN_UID" --gid "$DN_GID" --create-home --shell /bin/bash dn

# Install opencode agent harness (system-wide for non-root runtime user)
RUN curl -fsSL https://opencode.ai/install \
  | bash -s -- --version "$OPENCODE_VERSION" --no-modify-path \
  && if [ -x /root/.opencode/bin/opencode ]; then \
       install -m 0755 /root/.opencode/bin/opencode /usr/local/bin/opencode; \
     elif [ -x "$HOME/.opencode/bin/opencode" ]; then \
       install -m 0755 "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode; \
     else \
       echo "opencode binary not found after install" >&2; exit 1; \
     fi \
  && opencode --version

# Build dn CLI from repository sources (dn monorepo context).
# When publishing from chesapeakedev/dn-images, replace this stage with
# installing a released dn binary from GitHub Releases instead.
COPY deno.json deno.lock /opt/dn/
COPY cli /opt/dn/cli
COPY glance /opt/dn/glance
COPY kickstart /opt/dn/kickstart
COPY sdk /opt/dn/sdk
WORKDIR /opt/dn
RUN deno compile -A --output /usr/local/bin/dn cli/main.ts \
  && chown -R dn:dn /opt/dn

ENV WORKSPACE_ROOT=/workspace
RUN mkdir -p /workspace && chown dn:dn /workspace
WORKDIR /workspace
USER dn:dn

# Long-lived container for dn's docker sandbox runner (docker exec phases).
ENTRYPOINT ["sleep", "infinity"]
