import type { PublicClient, Hash, Address, Log } from 'viem'

export type MonitorConfig = {
  rpcUrl: string
  rpcRateLimit?: number
  startBlock?: bigint
  confirmations: number
  batchSize: number
  baseContracts: Address[]
  l2Source: string
}

export type MonitorState = {
  isRunning: boolean
  lastProcessedBlock: bigint
  client: PublicClient
  monitorId: string
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
  blockNumber: bigint
  blockHash: Hash
  timestamp: bigint
  txHash: Hash
  from: Address
  blobVersionedHashes: Hash[]
  l2Source: string
}

export type BlobTxLog = Log & {
  // Add specific event parameters if we are decoding known events
  // For now, we assume we get relevant info from the transaction receipt directly
} 