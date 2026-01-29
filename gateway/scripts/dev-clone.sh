#!/bin/bash
# Clone production workspace to dev
# Usage: ./scripts/dev-clone.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$GATEWAY_DIR")"

PROD_WORKSPACE="$REPO_DIR/workspace"
DEV_WORKSPACE="$REPO_DIR/workspace-dev"

echo "=== Clone Prod → Dev ==="
echo "Source: $PROD_WORKSPACE"
echo "Dest:   $DEV_WORKSPACE"
echo ""

# Check prod exists
if [ ! -d "$PROD_WORKSPACE" ]; then
    echo "Error: Production workspace not found at $PROD_WORKSPACE"
    exit 1
fi

# Confirm if dev has data
if [ -f "$DEV_WORKSPACE/SOUL.md" ] || [ -d "$DEV_WORKSPACE/memory.lance" ]; then
    read -p "Dev workspace has existing data. Overwrite? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Wipe dev
echo "Wiping dev workspace..."
rm -rf "$DEV_WORKSPACE"/*
rm -rf "$DEV_WORKSPACE"/.[!.]*  # Hidden files except . and ..

# Copy everything except .lance (will be regenerated)
echo "Copying prod files..."
rsync -av --exclude='*.lance' --exclude='memory.lance/' "$PROD_WORKSPACE/" "$DEV_WORKSPACE/"

# Create empty conversations if not exists
mkdir -p "$DEV_WORKSPACE/conversations"
echo '{"messages":[],"lastActivity":"'$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'"}' > "$DEV_WORKSPACE/conversations/messages.json"

echo ""
echo "Done! Dev workspace cloned from prod."
echo "Note: Vector memory (memory.lance) was NOT copied - will be fresh."
echo "Run migration if you want to populate it from markdown files."
