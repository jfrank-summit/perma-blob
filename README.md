# Ethereum L2 Blob Archival System

A functional TypeScript system that archives Ethereum L2 blob data to the Autonomys Network, preserving EIP-4844 blob transactions before they expire.

## Overview

This system monitors Base L2's EIP-4844 blob transactions on Ethereum L1 and permanently archives them to the Autonomys Network. EIP-4844 blobs are only available for ~18 days (4096 epochs) before they expire and are pruned from the network.

Key features:
- **Monitors EIP-4844 blob transactions** submitted by Base L2 to Ethereum L1
- **Permanent archival** to the Autonomys Network's Distributed Storage Network (DSN) before blob expiry (~18 days)
- **Preserves layer 2 transaction data** that may otherwise be lost after blob expiry
- **Easy retrieval** of archived blobs via CID
- **Data integrity** verification and metrics tracking

## Background

- **EIP-4844 (Proto-Danksharding)**: Introduced blob transactions that allow L2s like Base to post data to Ethereum L1 more efficiently
- **Blob Expiry**: Blobs are only stored for ~18 days (4096 epochs) on Ethereum nodes before being pruned
- **The Problem**: After blob expiry, L2 transaction data becomes inaccessible unless archived elsewhere
- **Our Solution**: Automatically detect and archive L2 blob data to Autonomys Network for permanent storage

## Prerequisites

- Node.js 18+ 
- Yarn package manager
- SQLite (default for local development)
- Redis (optional, for production job queue)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd perma-blob
yarn install
```

### 2. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Then configure the following:

#### Required API Keys

1. **Ethereum RPC URL**: 
   - Get from [Alchemy](https://www.alchemy.com/), [Infura](https://infura.io/), or use a public endpoint
   - Example: `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
   - Free tier available on most providers

2. **Auto Drive API Key**:
   - Sign up at [ai3.storage](https://ai3.storage)
   - Create a new API key in your dashboard
   - Use `TAURUS` network for testing (free)
   - Use `MAINNET` for production

#### Configuration Options

```bash
# Database (defaults to local SQLite)
DATABASE_TYPE=sqlite          # Use 'postgres' for production if needed
SQLITE_PATH=./data/perma-blob.db   # Local SQLite database file

# Ethereum Configuration  
ETH_RPC_URL=                  # Your Ethereum RPC endpoint
BEACON_API_URL=               # Your Beacon API endpoint (e.g., from QuickNode)
BASE_CONTRACTS=0x49048044D57e1C92A77f79988d21Fa8fAF74E97e,0xff00000000000000000000000000000000008453  # Base L2 contracts
CONFIRMATIONS=6               # Blocks to wait before processing
BATCH_SIZE=10                 # Blocks to process in parallel
BLOCKS_FROM_HEAD=100          # Optional: How many blocks from head to start if no DB state. 0 to start from earliest possible.
L2_SOURCE=base                # L2 source identifier

# Auto Drive
AUTO_DRIVE_API_KEY=           # Your API key from ai3.storage
AUTO_DRIVE_NETWORK=TAURUS     # TAURUS (testnet) or MAINNET

# Redis (optional, for production)
REDIS_URL=redis://localhost:6379

# API Server (if/when implemented)
PORT=3000
HOST=0.0.0.0

# Logging
LOG_LEVEL=info                # debug, info, warn, error
# LOG_FILE_PATH=./logs/app.log
# LOG_MAX_SIZE_MB=10
# LOG_MAX_FILES=5

# Blob Fetcher Configuration (optional, defaults are set in code)
# BLOB_FETCHER_RETRY_COUNT=3
# BLOB_FETCHER_RETRY_DELAY_MS=2000

# Blob Archiver Configuration (optional, defaults are set in code)
# AUTO_DRIVE_CONTAINER_NAME=perma-blob-testnet
# AUTO_DRIVE_CREATE_CONTAINER=true
```

### 3. Run the System

Development mode (with auto-reload):
```bash
yarn dev
```

Build and run production:
```bash
yarn build
yarn start
```

## Project Structure

```
src/
├── database/           # Database layer (PGLite/PostgreSQL)
│   ├── types.ts       # Database type definitions
│   ├── create-database.ts
│   ├── migrations.ts  # Schema migrations
│   └── repositories/  # Data access patterns
├── blob-monitor/      # Ethereum L1 monitoring for EIP-4844 txs
├── blob-fetcher/      # Blob data retrieval
├── blob-archiver/     # Auto Drive upload
├── blob-retriever/    # Blob download/verification
├── shared/            # Shared utilities
│   └── config.ts      # Configuration management
└── index.ts           # Application entry point
```

## Development

### Testing

```bash
yarn test              # Run tests
yarn test:ui           # Run tests with UI
yarn test:coverage     # Generate coverage report
```

### Code Quality

```bash
yarn typecheck         # TypeScript type checking
yarn lint              # ESLint checking
yarn format            # Prettier formatting
```

### Database Management

The system uses SQLite for local development by default and can be configured to use PostgreSQL for production. Migrations run automatically on startup.

To use PostgreSQL in production (ensure `DATABASE_TYPE=postgres` in `.env`):
```bash
# In your .env file for production:
DATABASE_TYPE=postgres
POSTGRES_URL=postgresql://user:password@host:5432/database
```

### Components

1. **Base Monitor**: Scans Ethereum L1 for Base L2's EIP-4844 blob transactions
2. **Blob Fetcher**: Retrieves blob data from L1 beacon chain before expiry
3. **Blob Archiver**: Uploads blobs to Autonomys Network
4. **Blob Retriever**: Downloads and verifies archived blobs
5. **Database**: Tracks processing state and blob metadata

## How It Works

1. **Detection**: Monitor watches Ethereum L1 for transactions from Base L2 contracts that include blob data (type 0x03/EIP-4844)
2. **Fetching**: When detected, the blob data is fetched from the Ethereum beacon chain
3. **Archival**: Blob data is packaged with metadata and uploaded to Autonomys Network via Auto Drive
4. **Indexing**: CIDs and metadata are stored in the database for easy retrieval
5. **Verification**: Archived blobs can be retrieved and verified against their original KZG commitments

## Why Archive Blobs?

EIP-4844 blobs are designed to be temporary - they expire after ~18 days to keep Ethereum node requirements manageable. However, this data represents important L2 transaction history that may be needed for:

- Historical analysis and auditing
- Regulatory compliance
- User transaction proofs
- L2 state reconstruction
- Research and analytics

By archiving to Autonomys Network, we ensure this data remains permanently accessible.

## Production Deployment

For production deployment:

1. Use PostgreSQL instead of SQLite
2. Set up Redis for job queue management
3. Configure proper RPC endpoints with rate limiting
4. Use environment-specific `.env` files
5. Set up monitoring and alerting

## License

MIT 