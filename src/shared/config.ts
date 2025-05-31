import { z } from 'zod'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

const databaseSchema = z.object({
  type: z.literal('sqlite').default('sqlite'), // Only sqlite
  sqlitePath: z.string().min(1).default('./data/perma-blob.db'),  
});

const configSchema = z.object({
  // Database
  database: databaseSchema,
  
  // Ethereum
  ethereum: z.object({
    rpcUrl: z.string().url(),
    beaconApiUrl: z.string().url().optional(),
    baseContracts: z.array(z.string()),
    confirmations: z.number().int().positive().default(6),
    batchSize: z.number().int().positive().default(10),
    blocksFromHead: z.number().int().nonnegative().optional(),
    l2Source: z.string().default('base'),
  }),
  
  // Auto Drive
  autoDrive: z.object({
    apiKey: z.string().min(1, "AUTO_DRIVE_API_KEY is required"),
    network: z.enum(['MAINNET', 'TAURUS']).default('TAURUS'),
  }),
  
  // Redis
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
  }),
  
  // API Server
  api: z.object({
    port: z.number().int().positive().default(3000),
    host: z.string().default('0.0.0.0'),
  }),
  
  // Logging
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    filePath: z.string().optional(),
    maxSizeMB: z.number().positive().optional(),
    maxFiles: z.number().int().positive().optional(),
  }),

  // Blob Fetcher
  blobFetcher: z.object({
    retryCount: z.number().int().positive().default(3),
    retryDelayMs: z.number().int().positive().default(2000),
  }).optional(), // Making entire object optional, with defaults for its fields

  // Blob Archiver
  blobArchiver: z.object({
    autoDriveContainerName: z.string().optional().default('eth-l2-blobs'),
    autoDriveCreateContainerIfNotExists: z.boolean().optional().default(true),
  }).optional(),
})

export type Config = z.infer<typeof configSchema>

const parseEnvNumber = (value: string | undefined, defaultValue?: number): number | undefined => {
  if (value === undefined && defaultValue === undefined) return undefined;
  const parsed = parseInt(value || '', 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

// Helper function for parsing boolean environment variables
const parseEnvBoolean = (value: string | undefined, defaultValue?: boolean): boolean | undefined => {
  if (value === undefined && defaultValue === undefined) return undefined;
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  return value!.toLowerCase() === 'true';
};

export const loadConfig = (): Config => {
  dotenv.config();

  const ethereumRpcUrl = process.env['ETH_RPC_URL'];
  if (!ethereumRpcUrl) {
    throw new Error('ETH_RPC_URL is not set in the environment variables.');
  }

  const rawConfig = {
    database: {
      type: 'sqlite', // Hardcode to sqlite
      sqlitePath: process.env['SQLITE_PATH'], 
    },
    ethereum: {
      rpcUrl: ethereumRpcUrl,
      beaconApiUrl: process.env['BEACON_API_URL'],
      baseContracts: process.env['BASE_CONTRACTS'] ? process.env['BASE_CONTRACTS'].split(',') : [],
      confirmations: parseEnvNumber(process.env['CONFIRMATIONS']),
      batchSize: parseEnvNumber(process.env['BATCH_SIZE']),
      blocksFromHead: parseEnvNumber(process.env['BLOCKS_FROM_HEAD']),
      l2Source: process.env['L2_SOURCE'],
    },
    autoDrive: {
      apiKey: process.env['AUTO_DRIVE_API_KEY'],
      network: process.env['AUTO_DRIVE_NETWORK'] as 'MAINNET' | 'TAURUS' | undefined,
    },
    redis: {
      url: process.env['REDIS_URL'],
    },
    api: {
      port: parseEnvNumber(process.env['PORT']),
      host: process.env['HOST'],
    },
    logging: {
      level: (process.env['LOG_LEVEL'] || 'info') as 'debug' | 'info' | 'warn' | 'error',
      filePath: process.env['LOG_FILE_PATH'],
      maxSizeMB: parseEnvNumber(process.env['LOG_MAX_SIZE_MB']),
      maxFiles: parseEnvNumber(process.env['LOG_MAX_FILES'])
    },
    blobFetcher: {
      retryCount: parseEnvNumber(process.env['BLOB_FETCHER_RETRY_COUNT']),
      retryDelayMs: parseEnvNumber(process.env['BLOB_FETCHER_RETRY_DELAY_MS']),
    },
    blobArchiver: {
      autoDriveContainerName: process.env['AUTO_DRIVE_CONTAINER_NAME'],
      autoDriveCreateContainerIfNotExists: parseEnvBoolean(process.env['AUTO_DRIVE_CREATE_CONTAINER']),
    },
  }
  
  try {
    const parsedConfig = configSchema.parse(rawConfig)
    return parsedConfig
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Configuration validation error:', JSON.stringify(error.issues, null, 2));
    } else {
      console.error('Unknown error during configuration loading:', error)
    }
    throw new Error('Configuration validation failed')
  }
} 