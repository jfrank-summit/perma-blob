# Ethereum L2 Blob Archival System

A functional TypeScript system that archives Ethereum L2 blob data to the Autonomys Network, addressing the upcoming EIP-4444 changes where Ethereum nodes will only store recent history.

## Overview

This system monitors Base L2 blob submissions on Ethereum L1 and permanently archives them to the Autonomys Network using the Auto Drive SDK. It provides:

- **Automatic monitoring** of Base L2 blob transactions on Ethereum L1
- **Permanent archival** to the decentralized Autonomys Network
- **Easy retrieval** of archived blobs via CID
- **Data integrity** verification and metrics tracking

## Prerequisites

- Node.js 18+ 
- Yarn package manager
- Redis (optional, for production job queue)
- PostgreSQL (optional, for production database)

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
# Database (defaults to local PGLite)
DATABASE_TYPE=pglite          # Use 'postgres' for production
PGLITE_PATH=./data/blobs.db   # Local database file

# Ethereum Configuration  
ETH_RPC_URL=                  # Your Ethereum RPC endpoint
BASE_CONTRACTS=0x49048044D57e1C92A77f79988d21Fa8fAF74E97e  # Base L2 contracts
CONFIRMATIONS=3               # Blocks to wait before processing
BATCH_SIZE=10                 # Blocks to process in parallel
START_BLOCK=                  # Optional: specific block to start from

# Auto Drive
AUTO_DRIVE_API_KEY=           # Your API key from ai3.storage
AUTO_DRIVE_NETWORK=TAURUS     # TAURUS (testnet) or MAINNET

# Redis (optional, for production)
REDIS_URL=redis://localhost:6379

# API Server
PORT=3000
HOST=0.0.0.0

# Logging
LOG_LEVEL=info                # debug, info, warn, error
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
├── blob-monitor/      # Ethereum L1 monitoring
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

The system uses PGLite for local development and can migrate to PostgreSQL for production. Migrations run automatically on startup.

To use PostgreSQL in production:
```bash
DATABASE_TYPE=postgres
DATABASE_URL=postgresql://user:password@host:5432/database
```

## Architecture

The system follows functional programming principles:
- No classes, only pure functions
- Immutable data structures
- Explicit dependency injection
- Strong TypeScript typing

### Components

1. **Base Monitor**: Scans Ethereum L1 for Base L2 blob transactions
2. **Blob Fetcher**: Retrieves blob data from L1 
3. **Blob Archiver**: Uploads blobs to Autonomys Network
4. **Blob Retriever**: Downloads and verifies archived blobs
5. **Database**: Tracks processing state and blob metadata

## Production Deployment

For production deployment:

1. Use PostgreSQL instead of PGLite
2. Set up Redis for job queue management
3. Configure proper RPC endpoints with rate limiting
4. Use environment-specific `.env` files
5. Set up monitoring and alerting

## Contributing

This project follows functional programming principles. Please ensure:
- All functions are pure where possible
- No classes or OOP patterns
- Immutable data structures
- Comprehensive TypeScript types
- Tests for critical functions

## License

MIT 