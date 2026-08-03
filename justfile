set shell := ["bash", "-cu"]

default:
    just --list

# Build and install the global `nex` command (via volta's npm shim)
install:
    pnpm build
    npm install -g .

dev:
    pnpm dev

test:
    pnpm test

check:
    pnpm check
