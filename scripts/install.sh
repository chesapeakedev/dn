#!/bin/bash
set -e

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
    --version <tag>      Version to install (default: latest)
    -h, --help           Show this help message

EXAMPLES:
    $0                          # Install latest version to ~/.local/bin
    $0 --version v0.1.0        # Install specific version
    $0 --install-dir /usr/local/bin  # Custom install directory
EOF
}

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
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
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
        x86_64)   echo "x64" ;;
        aarch64|arm64) echo "arm64" ;;
        *)       echo "unsupported" ;;
    esac
}

get_release_url() {
    if [[ "$VERSION" == "latest" ]]; then
        echo "https://api.github.com/repos/${REPO}/releases/latest"
    else
        local version_tag="$VERSION"
        if [[ ! "$version_tag" =~ ^v ]]; then
            version_tag="v${version_tag}"
        fi
        echo "https://api.github.com/repos/${REPO}/releases/tags/${version_tag}"
    fi
}

fetch_json() {
    curl -sS --fail "$1"
}

download_asset() {
    local url="$1"
    local dest="$2"
    curl -sS --fail -L -o "$dest" "$url"
}

main() {
    local os
    os=$(detect_os)
    if [[ "$os" == "unsupported" ]]; then
        echo "Error: Unsupported operating system" >&2
        exit 1
    fi

    local arch
    arch=$(detect_arch)
    if [[ "$arch" == "unsupported" ]]; then
        echo "Error: Unsupported architecture: $(uname -m)" >&2
        exit 1
    fi

    if [[ "$os" == "windows" ]]; then
        local binary_name="dn-${os}-${arch}.exe"
    else
        local binary_name="dn-${os}-${arch}"
    fi

    echo "Detected: ${os}-${arch}"
    echo "Installing dn ${VERSION}..."

    local release_url
    release_url=$(get_release_url)

    local release_json
    release_json=$(fetch_json "$release_url")

    local tag_name
    tag_name=$(echo "$release_json" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)

    if [[ -z "$tag_name" ]]; then
        echo "Error: Could not determine release tag" >&2
        exit 1
    fi

    if [[ "$VERSION" != "latest" ]] && [[ "$tag_name" != "v${VERSION#v}" ]]; then
        echo "Warning: Requested version '$VERSION' not found, installing '$tag_name' instead"
    fi

    local download_url
    download_url="${BASE_URL}/download/${tag_name}/${binary_name}"

    local checksum_url="${BASE_URL}/download/${tag_name}/checksums.txt"

    local tmpdir
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    local binary_path="${tmpdir}/${binary_name}"
    local checksum_path="${tmpdir}/checksums.txt"

    echo "Downloading ${binary_name}..."
    download_asset "$download_url" "$binary_path"

    echo "Downloading checksums..."
    download_asset "$checksum_url" "$checksum_path"

    echo "Verifying SHA256..."
    local expected_hash
    expected_hash=$(grep "$binary_name" "$checksum_path" | awk '{print $1}' | tr -d '\r')

    if [[ -z "$expected_hash" ]]; then
        echo "Error: Could not find SHA256 for ${binary_name} in checksums" >&2
        exit 1
    fi

    local actual_hash
    actual_hash=$(sha256sum "$binary_path" | awk '{print $1}')

    if [[ "$expected_hash" != "$actual_hash" ]]; then
        echo "Error: SHA256 mismatch!" >&2
        echo "Expected: $expected_hash" >&2
        echo "Actual:   $actual_hash" >&2
        exit 1
    fi

    echo "SHA256 verified"

    if [[ ! -d "$INSTALL_DIR" ]]; then
        echo "Creating install directory: $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi

    cp "$binary_path" "${INSTALL_DIR}/dn"
    chmod +x "${INSTALL_DIR}/dn"

    echo ""
    echo "✅ Installed successfully to ${INSTALL_DIR}/dn"
    echo ""
    echo "Add to PATH if needed:"
    echo "  export PATH=\"\$PATH:${INSTALL_DIR}\""
    echo ""
    echo "Or use full path: ${INSTALL_DIR}/dn --help"
}

main