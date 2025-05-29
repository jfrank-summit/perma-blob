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
    baseContracts: z.array(z.string()),
    confirmations: z.number().int().positive(),
    batchSize: z.number().int().positive(),
    startBlock: z.bigint().optional(),
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
})

export type Config = z.infer<typeof configSchema>

const parseEnvArray = (value: string | undefined): string[] => {
  if (!value) return []
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

const parseEnvNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = parseInt(value || '', 10)
  return isNaN(parsed) ? defaultValue : parsed
}

const parseEnvBigInt = (value: string | undefined): bigint | undefined => {
  if (!value) return undefined
  try {
    return BigInt(value)
  } catch {
    return undefined
  }
}

export const loadConfig = (): Config => {
  const rawConfig = {
    database: {
      type: process.env['DATABASE_TYPE'] || 'pglite',
      pglitePath: process.env['PGLITE_PATH'],
      postgresUrl: process.env['DATABASE_URL'],
    },
    ethereum: {
      rpcUrl: process.env['ETH_RPC_URL'] || '',
      baseContracts: parseEnvArray(process.env['BASE_CONTRACTS']),
      confirmations: parseEnvNumber(process.env['CONFIRMATIONS'], 3),
      batchSize: parseEnvNumber(process.env['BATCH_SIZE'], 5),
      startBlock: parseEnvBigInt(process.env['START_BLOCK']),
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