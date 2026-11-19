#!/usr/bin/env bash
set -euo pipefail

# Vercel's Node build image does not include the Rust/WebAssembly toolchain.
# Install it on demand so the existing Rust -> WASM build remains enabled.
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"

if ! command -v rustup >/dev/null 2>&1; then
  echo "Installing minimal stable Rust toolchain..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
  export PATH="$CARGO_HOME/bin:$PATH"
fi

if ! rustup target list --installed | grep -qx 'wasm32-unknown-unknown'; then
  echo "Installing wasm32-unknown-unknown target..."
  rustup target add wasm32-unknown-unknown
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "Installing wasm-pack..."
  curl --proto '=https' --tlsv1.2 -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
  export PATH="$CARGO_HOME/bin:$PATH"
fi

echo "Building GRIXDroid WebAssembly package..."
npm run build:wasm

echo "Type-checking and building GRIXDroid frontend..."
npx tsc
npx vite build
