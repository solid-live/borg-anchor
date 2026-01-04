# borg-anchor

[![npm version](https://img.shields.io/npm/v/borg-anchor.svg)](https://www.npmjs.com/package/borg-anchor)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Borg backups with Bitcoin timestamping. Your data lives on forever.

## Overview

borg-anchor combines [BorgBackup](https://borgbackup.readthedocs.io/) (deduplicating archiver) with Bitcoin timestamping to create backups with cryptographic proof of existence.

```
Your Data → Borg Backup → Bitcoin Anchor → Immortal Proof
```

## Features

- **Deduplication** - Only store changes, not duplicates
- **Compression** - Efficient storage with lz4/zstd
- **Encryption** - Optional AES-256 encryption
- **Bitcoin Timestamping** - Immutable proof your backup existed
- **Chained Proofs** - Each backup linked to previous via UTXO chain

## Installation

```bash
npm install -g borg-anchor
```

### Prerequisites

- [BorgBackup](https://borgbackup.readthedocs.io/en/stable/installation.html) installed
- [blocktrails](https://github.com/blocktrails/blocktrails) CLI for Bitcoin anchoring
- Node.js 18+

## Quick Start

```bash
# Initialize a new backup repository
borg-anchor init ~/backups

# Configure your Bitcoin key
cd ~/backups
git config nostr.privkey <your-hex-privkey>

# Create your first backup
borg-anchor backup ~/mydata --name first-backup

# View all projects and backups
borg-anchor info

# List backups in current project
borg-anchor list

# Verify a backup is anchored
borg-anchor verify first-backup

# Restore a backup
borg-anchor restore first-backup /tmp/restore
```

## Commands

| Command | Description |
|---------|-------------|
| `info` | Dashboard of all projects and backups |
| `init [path]` | Initialize borg repo and config |
| `backup <source>` | Create backup and anchor on Bitcoin |
| `list` | List backups and trail status |
| `verify <archive>` | Verify backup is anchored |
| `restore <archive> [dest]` | Restore backup to destination |
| `show` | Show config and trail status |

## Options

### Init Options

| Option | Default | Description |
|--------|---------|-------------|
| `--repo <name>` | `repo` | Borg repository directory name |
| `--encryption <type>` | `none` | `none`, `repokey`, `repokey-blake2` |
| `--network <net>` | `tbtc4` | `btc` (mainnet) or `tbtc4` (testnet) |

### Backup Options

| Option | Default | Description |
|--------|---------|-------------|
| `--name <name>` | `backup-YYYY-MM-DD` | Archive name |
| `--no-anchor` | - | Skip Bitcoin anchoring |
| `--dry` | - | Dry run (don't broadcast) |

## How It Works

1. **Borg creates a deduplicated backup** with a unique fingerprint (SHA-256)
2. **The fingerprint is anchored on Bitcoin** via a chained UTXO trail
3. **Anyone can verify** the backup existed at the anchored time

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Your Files  │ ──▶ │ Borg Backup │ ──▶ │  Bitcoin TX │
│             │     │ fingerprint │     │  timestamp  │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Files

After initialization, your backup directory contains:

```
~/backups/
├── .borg-anchor.json   # Configuration
├── .blocktrail.json    # Bitcoin trail state
├── .git/               # Git repo (holds keys)
└── repo/               # Borg repository
```

Projects are also registered globally for the dashboard:

```
~/.borg-anchor/
└── projects.json       # List of all borg-anchor projects
```

## Verification

To verify a backup:

```bash
# Get the fingerprint
borg info ~/backups/repo::my-backup | grep fingerprint

# Check it's anchored
borg-anchor verify my-backup
```

The fingerprint in your backup must match the fingerprint recorded on Bitcoin.

## Networks

| Network | Flag | Use Case |
|---------|------|----------|
| `tbtc4` | `--network tbtc4` | Testing (free, default) |
| `btc` | `--network btc` | Production (real Bitcoin) |

## License

AGPL-3.0

## Links

- [Documentation](https://solid-live.github.io/borg-anchor/)
- [GitHub](https://github.com/solid-live/borg-anchor)
- [npm](https://www.npmjs.com/package/borg-anchor)
- [BorgBackup](https://borgbackup.readthedocs.io/)
- [solid.live](https://solid.live)
