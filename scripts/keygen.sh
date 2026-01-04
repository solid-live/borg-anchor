#!/bin/bash
# keygen.sh - Generate a keypair for borg-anchor
# Usage: ./keygen.sh [--save]
#
# Generates a random 32-byte hex private key suitable for Bitcoin/Nostr.
# Use --save to automatically configure the current borg-anchor repo.

set -e

# Generate random 32-byte hex key
PRIVKEY=$(openssl rand -hex 32)

echo ""
echo "  Generated Private Key (hex):"
echo "  ────────────────────────────────────────────────────────────────────"
echo "  $PRIVKEY"
echo "  ────────────────────────────────────────────────────────────────────"
echo ""
echo "  IMPORTANT: Save this key somewhere safe!"
echo ""

# If --save flag is passed, configure git
if [[ "$1" == "--save" ]]; then
    if [[ -f ".borg-anchor.json" ]]; then
        git config nostr.privkey "$PRIVKEY"
        echo "  ✓ Key saved to git config (nostr.privkey)"
        echo ""
        echo "  Next steps:"
        echo "    1. Run 'blocktrails show' to see your testnet address"
        echo "    2. Get testnet coins from a faucet:"
        echo "       https://github.com/testnet4/awesome-testnet4#faucets"
        echo "    3. Run 'borg-anchor backup <source>' to create an anchored backup"
        echo ""
    else
        echo "  Error: Not in a borg-anchor directory."
        echo "  Run 'borg-anchor init' first, or manually configure with:"
        echo ""
        echo "    git config nostr.privkey $PRIVKEY"
        echo ""
        exit 1
    fi
else
    echo "  To configure borg-anchor with this key:"
    echo ""
    echo "    cd ~/my-backups"
    echo "    git config nostr.privkey $PRIVKEY"
    echo ""
    echo "  Or run this script with --save in a borg-anchor directory:"
    echo ""
    echo "    ./keygen.sh --save"
    echo ""
fi
