import { z } from 'zod'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const configSchema = z.object({
  // Database
  database: z.object({
    type: z.enum(['pglite', 'postgres']),
    pglitePath: z.string().optional(),
    postgresUrl: z.string().optional(),
  }),
  
  // Ethereum
  ethereum: z.object({
    rpcUrl: z.string().url(),
    beaconApiUrl: z.string().url().optional(),
    baseContracts: z.array(z.string()),
    confirmations: z.number().int().positive(),
    batchSize: z.number().int().positive(),
    startBlock: z.bigint().nonnegative(),
    l2Source: z.string(),
  }),
  
  // Auto Drive
  autoDrive: z.object({
    apiKey: z.string(),
    network: z.enum(['MAINNET', 'TAURUS']),
  }),
  
  // Redis
  redis: z.object({
    url: z.string(),
  }),
  
  // API Server
  api: z.object({
    port: z.number().int().positive(),
    host: z.string(),
  }),
  
  // Logging
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    filePath: z.string().optional(),
    maxSizeMB: z.number().positive().optional(),
    maxFiles: z.number().int().positive().optional()
  }),

  // Blob Fetcher
  blobFetcher: z.object({
    retryCount: z.number().int().positive(),
    retryDelayMs: z.number().int().positive(),
  }).optional(),

  // Blob Archiver
  blobArchiver: z.object({
    autoDriveContainerName: z.string().optional(),
    autoDriveCreateContainerIfNotExists: z.boolean().optional(),
  }).optional(),
})

export type Config = z.infer<typeof configSchema>

const parseEnvNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = parseInt(value || '', 10)
  return isNaN(parsed) ? defaultValue : parsed
}

// Helper function for parsing boolean environment variables
const parseEnvBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
};

export const loadConfig = (): Config => {
  dotenv.config();

  const ethereumRpcUrl = process.env['ETH_RPC_URL'];
  if (!ethereumRpcUrl) {
    throw new Error('ETH_RPC_URL is not set in the environment variables.');
  }

  const beaconApiUrl = process.env['BEACON_API_URL'];

  const rawConfig = {
    database: {
      type: process.env['DATABASE_TYPE'] || 'pglite',
      pglitePath: process.env['PGLITE_PATH'] || './data/blobs.db',
      postgresUrl: process.env['POSTGRES_URL'],
    },
    ethereum: {
      rpcUrl: ethereumRpcUrl,
      beaconApiUrl: beaconApiUrl,
      baseContracts: process.env['BASE_CONTRACTS'] ? process.env['BASE_CONTRACTS'].split(',') : [],
      confirmations: process.env['CONFIRMATIONS'] ? parseInt(process.env['CONFIRMATIONS'], 10) : 3,
      batchSize: process.env['BATCH_SIZE'] ? parseInt(process.env['BATCH_SIZE'], 10) : 10,
      startBlock: process.env['START_BLOCK'] ? BigInt(process.env['START_BLOCK']) : 0,
      l2Source: process.env['L2_SOURCE'] || 'base',
    },
    autoDrive: {
      apiKey: process.env['AUTO_DRIVE_API_KEY'] || '',
      network: process.env['AUTO_DRIVE_NETWORK'] || 'MAINNET',
    },
    redis: {
      url: process.env['REDIS_URL'] || 'redis://localhost:6379',
    },
    api: {
      port: parseEnvNumber(process.env['PORT'], 3000),
      host: process.env['HOST'] || '0.0.0.0',
    },
    logging: {
      level: process.env['LOG_LEVEL'] || 'info',
      filePath: process.env['LOG_FILE_PATH'] || './logs/app.log',
      maxSizeMB: parseEnvNumber(process.env['LOG_MAX_SIZE_MB'], 50),
      maxFiles: parseEnvNumber(process.env['LOG_MAX_FILES'], 5)
    },
    blobFetcher: {
      retryCount: parseEnvNumber(process.env['BLOB_FETCHER_RETRY_COUNT'], 3),
      retryDelayMs: parseEnvNumber(process.env['BLOB_FETCHER_RETRY_DELAY_MS'], 2000),
    },
    blobArchiver: {
      autoDriveContainerName: process.env['AUTO_DRIVE_CONTAINER_NAME'] || 'eth-l2-blobs',
      autoDriveCreateContainerIfNotExists: parseEnvBoolean(process.env['AUTO_DRIVE_CREATE_CONTAINER'], true),
    },
  }
  
  try {
    return configSchema.parse(rawConfig)
  } catch (error) {
    console.error('Configuration validation failed:')
    if (error instanceof z.ZodError) {
      error.errors.forEach(err => {
        console.error(`  ${err.path.join('.')}: ${err.message}`)
      })
    }
    throw new Error('Invalid configuration')
  }
} 