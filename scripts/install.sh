#!/bin/bash
set -euo pipefail

INSTALL_DIR="${HOME}/.local/bin"
VERSION="latest"
REPO="chesapeakedev/dn"
BASE_URL="https://github.com/${REPO}/releases"

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Install dn binary from GitHub Releases.

OPTIONS:
    --install-dir <path>  Install directory (default: ~/.local/bin)
    --version <tag>       Version to install (default: latest)
    -y, --yes             Skip confirmation prompt (non-interactive)
    -h, --help            Show this help message

EXAMPLES:
    $0                           # Install latest version to ~/.local/bin
    $0 --version v0.1.0         # Install specific version
    $0 --install-dir /usr/local/bin  # Custom install directory
    curl -fsSL $URL | sh         # Pipe install (implies -y)
EOF
}

YES=0

while [[ $# -gt 0 ]]; do
    case $1 in
        --install-dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        -y|--yes)
            YES=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage
            exit 1
            ;;
    esac
done

detect_os() {
    case "$(uname -s)" in
        Linux*)  echo "linux" ;;
        Darwin*) echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        *)      echo "unsupported" ;;
    esac
}

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64) echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        i686|i386)    echo "x86" ;;
        *)            echo "unsupported" ;;
    esac
}

sha256hash() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        echo "Error: No SHA-256 utility found (install coreutils or sha256sum)" >&2
        exit 1
    fi
}

normalize_version_tag() {
    local tag="$1"
    if [[ ! "$tag" =~ ^v ]]; then
        tag="v${tag}"
    fi
    echo "$tag"
}

construct_urls() {
    local os="$1"
    local arch="$2"
    local version="$3"

    if [[ "$os" == "windows" ]]; then
        BINARY_NAME="dn-${os}-${arch}.exe"
    else
        BINARY_NAME="dn-${os}-${arch}"
    fi

    if [[ "$version" == "latest" ]]; then
        DOWNLOAD_URL="${BASE_URL}/latest/download/${BINARY_NAME}"
        CHECKSUM_URL="${BASE_URL}/latest/download/checksums.txt"
    else
        local tag
        tag=$(normalize_version_tag "$version")
        DOWNLOAD_URL="${BASE_URL}/download/${tag}/${BINARY_NAME}"
        CHECKSUM_URL="${BASE_URL}/download/${tag}/checksums.txt"
    fi
}

confirm_install() {
    if [[ $YES -eq 1 ]]; then
        return 0
    fi

    if [[ ! -t 0 ]]; then
        # stdin is a pipe — assume non-interactive
        return 0
    fi

    echo ""
    echo "This will install dn to: ${INSTALL_DIR}/dn"
    echo "Proceed? [Y/n] "
    read -r reply
    case "$reply" in
        n|N|no|NO) exit 0 ;;
        *) return 0 ;;
    esac
}

main() {
    local os
    os=$(detect_os)
    if [[ "$os" == "unsupported" ]]; then
        echo "Error: Unsupported operating system ($(uname -s))" >&2
        exit 1
    fi

    local arch
    arch=$(detect_arch)
    if [[ "$arch" == "unsupported" ]]; then
        echo "Error: Unsupported architecture: $(uname -m)" >&2
        exit 1
    fi

    construct_urls "$os" "$arch" "$VERSION"

    echo "Detected: ${os}-${arch}"
    echo "Target:   ${INSTALL_DIR}/dn"

    confirm_install

    local tmpdir
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    local binary_path="${tmpdir}/${BINARY_NAME}"

    echo ""
    echo "Downloading ${BINARY_NAME}..."
    curl -fsSL -o "$binary_path" "$DOWNLOAD_URL"

    # Attempt checksum verification (best-effort — not all releases have checksums)
    local checksum_path="${tmpdir}/checksums.txt"
    if curl -fsSL -o "$checksum_path" "$CHECKSUM_URL" 2>/dev/null; then
        local expected_hash
        expected_hash=$(grep "$BINARY_NAME" "$checksum_path" | awk '{print $1}' | tr -d '\r')

        if [[ -n "$expected_hash" ]]; then
            echo "Verifying SHA256..."
            local actual_hash
            actual_hash=$(sha256hash "$binary_path")

            if [[ "$expected_hash" != "$actual_hash" ]]; then
                echo "Error: SHA256 mismatch!" >&2
                echo "Expected: $expected_hash" >&2
                echo "Actual:   $actual_hash" >&2
                exit 1
            fi
            echo "SHA256 verified"
        else
            echo "Warning: Could not find checksum for ${BINARY_NAME} in checksums.txt, skipping verification" >&2
        fi
    else
        echo "Warning: checksums.txt not available for this release, skipping SHA256 verification" >&2
    fi

    if [[ ! -d "$INSTALL_DIR" ]]; then
        echo "Creating install directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    install "$binary_path" "${INSTALL_DIR}/dn"

    echo ""
    echo "  Installed dn to ${INSTALL_DIR}/dn"
    echo ""
    echo "  Add to PATH if needed:"
    echo "    export PATH=\"\$PATH:${INSTALL_DIR}\""
    echo ""
    echo "  Run: dn --help"
}

main