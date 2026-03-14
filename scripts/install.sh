#!/bin/bash

# ACP Composer Extension - Build and Install Script
# This script builds the extension and installs it to VS Code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "ACP Composer - Build and Install"
echo "========================================"
echo ""

# Change to project directory
cd "$PROJECT_DIR"

# Skip install if node_modules exists
if [ -d "node_modules" ]; then
    echo "✅ Dependencies already installed"
else
    echo "📦 Installing dependencies with pnpm..."
    pnpm install
fi

echo ""
echo "🔨 Building and packaging extension..."
pnpm run build

# Package with vsce (ignore npm warnings from vsce internal dependency checks)
# The vsix file is created successfully despite these warnings
pnpm exec vsce package --out "$PROJECT_DIR/acp-composer-0.1.0.vsix" || true

echo ""
echo "📥 Installing extension to VS Code..."
code --install-extension "$PROJECT_DIR/acp-composer-0.1.0.vsix" --force

echo ""
echo "========================================"
echo "✅ Installation complete!"
echo "========================================"
echo ""
echo "To use the extension:"
echo "  1. Reload VS Code (Cmd+Shift+P → 'Reload Window')"
echo "  2. Click the ACP Composer icon in the Activity Bar"
echo "  3. Connect to an agent using the buttons in the status bar"
echo ""
