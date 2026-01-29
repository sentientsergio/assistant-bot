#!/bin/bash
# Wipe dev workspace to clean slate
# Usage: ./scripts/dev-wipe.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$GATEWAY_DIR")"

DEV_WORKSPACE="$REPO_DIR/workspace-dev"

echo "=== Wipe Dev Workspace ==="
echo "Target: $DEV_WORKSPACE"
echo ""

# Confirm
read -p "This will delete ALL dev data (memory, conversations, etc). Continue? [y/N] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Wipe everything
echo "Wiping..."
rm -rf "$DEV_WORKSPACE"/*
rm -rf "$DEV_WORKSPACE"/.[!.]*

# Recreate structure
mkdir -p "$DEV_WORKSPACE/memory"
mkdir -p "$DEV_WORKSPACE/conversations"

# Create empty conversations file
echo '{"messages":[],"lastActivity":"'$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'"}' > "$DEV_WORKSPACE/conversations/messages.json"

echo ""
echo "Done! Dev workspace is clean."
echo "Copy identity files (SOUL.md, etc.) or run dev-clone.sh to clone from prod."
