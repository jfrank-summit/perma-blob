import type { PublicClient, Hash } from 'viem'

export type MonitorConfig = {
  rpcUrl: string
  rpcRateLimit?: number
  startBlock?: bigint
  confirmations?: number
  batchSize?: number
  baseContracts: string[]
}

export type MonitorState = {
  isRunning: boolean
  lastProcessedBlock: bigint
  client: PublicClient
}

export type BlobTransaction = {
  hash: Hash
  from: string
  blockNumber: bigint
  blockHash: Hash
  timestamp: bigint
  blobVersionedHashes: string[]
}

export type ProcessingJob = {
  txHash: string
  blockNumber: bigint
  blockHash: string
  timestamp: bigint
  blobVersionedHashes: string[]
  from: string
} 