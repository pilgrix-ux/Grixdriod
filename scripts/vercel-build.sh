#!/usr/bin/env bash
set -euo pipefail

# GRIXDroid's production entry point is the cloud Android workspace.
# The retired browser ARM demo is not part of the deployed application.
echo "Type-checking GRIXDroid..."
npx tsc

echo "Building GRIXDroid frontend..."
npx vite build
