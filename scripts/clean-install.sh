#!/bin/bash
set -e

echo "Removing node_modules..."
rm -rf /vercel/share/v0-project/node_modules
rm -rf /vercel/share/v0-project/.next

echo "Cleaning pnpm store cache for this project..."
pnpm store prune 2>/dev/null || true

echo "Installing dependencies fresh..."
cd /vercel/share/v0-project
pnpm install --no-frozen-lockfile

echo "Verifying lucide-react installation..."
ls -la node_modules/lucide-react/package.json 2>/dev/null && echo "lucide-react found!" || echo "lucide-react NOT found"

echo "Done!"
