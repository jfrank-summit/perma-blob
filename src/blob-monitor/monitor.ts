import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import type { MonitorConfig, MonitorState, ProcessingJob } from './types.js'
import type { Database } from '../database/types.js'
import { createMonitorStateRepository } from '../database/repositories/monitor-state.js'
import { processBlock } from './block-processor.js'
import { logger } from '../shared/logger.js'

export const createMonitorState = async (
  config: MonitorConfig,
  db: Database
): Promise<MonitorState> => {
  const client = createPublicClient({
    chain: mainnet,
    transport: http(config.rpcUrl, {
      retryCount: 3,
      retryDelay: 1000
    })
  })
  
  const stateRepo = createMonitorStateRepository(db)
  const lastProcessedBlock = await stateRepo.getLastProcessedBlock()
  
  return {
    isRunning: false,
    lastProcessedBlock: config.startBlock ?? lastProcessedBlock,
    client
  }
}

export const startMonitor = async (
  config: MonitorConfig,
  state: MonitorState,
  db: Database,
  onBlobFound: (blob: ProcessingJob) => Promise<void>
): Promise<() => void> => {
  const updatedState = { ...state, isRunning: true }
  const stateRepo = createMonitorStateRepository(db)
  
  // Start monitoring loop
  const abortController = new AbortController()
  
  const monitorLoop = async () => {
    while (!abortController.signal.aborted) {
      try {
        const latestBlock = await updatedState.client.getBlockNumber()
        const targetBlock = latestBlock - BigInt(config.confirmations || 3)
        
        if (updatedState.lastProcessedBlock < targetBlock) {
          const fromBlock = updatedState.lastProcessedBlock + 1n
          const maxBlocks = fromBlock + 99n
          const toBlock = maxBlocks < targetBlock ? maxBlocks : targetBlock // Limit range to 100 blocks
          
          logger.info(`Processing blocks ${fromBlock} to ${toBlock} (latest: ${latestBlock})`)
          
          const processedBlock = await processBlockRange(
            updatedState,
            config,
            fromBlock,
            toBlock,
            onBlobFound
          )
          
          // Update state immutably
          updatedState.lastProcessedBlock = processedBlock
          await stateRepo.updateLastProcessedBlock(processedBlock)
          
          logger.info(`Completed processing up to block ${processedBlock}`)
        } else {
          logger.debug(`Waiting for new blocks... (current: ${updatedState.lastProcessedBlock}, target: ${targetBlock})`)
        }
        
        // Wait for next block
        await sleep(12000, abortController.signal)
      } catch (error) {
        if (!abortController.signal.aborted) {
          logger.error('Monitor loop error:', error)
          await sleep(5000, abortController.signal)
        }
      }
    }
  }
  
  monitorLoop()
  logger.info('Blob monitor started')
  
  // Return stop function
  return () => {
    logger.info('Stopping blob monitor...')
    abortController.abort()
  }
}

const processBlockRange = async (
  state: MonitorState,
  config: MonitorConfig,
  fromBlock: bigint,
  toBlock: bigint,
  onBlobFound: (blob: ProcessingJob) => Promise<void>
): Promise<bigint> => {
  const configBatchSize = config.batchSize || 10
  const batchSize = configBatchSize > 5 ? 5 : configBatchSize // Reduce batch size for debugging
  let currentBlock = fromBlock
  let processedCount = 0
  
  while (currentBlock <= toBlock) {
    const endBlock = currentBlock + BigInt(batchSize - 1)
    const batchEnd = endBlock > toBlock ? toBlock : endBlock
    
    logger.debug(`Processing batch: blocks ${currentBlock} to ${batchEnd}`)
    
    // Process batch in parallel
    const blockPromises = []
    for (let i = currentBlock; i <= batchEnd; i++) {
      blockPromises.push(
        processBlockNumber(state, config, i, onBlobFound)
      )
    }
    
    try {
      await Promise.all(blockPromises)
      processedCount += Number(batchEnd - currentBlock + 1n)
      
      if (processedCount % 50 === 0) {
        logger.info(`Progress: processed ${processedCount} blocks`)
      }
    } catch (error) {
      logger.error(`Error processing batch ${currentBlock}-${batchEnd}:`, error)
      throw error
    }
    
    currentBlock = batchEnd + 1n
  }
  
  return toBlock
}

const processBlockNumber = async (
  state: MonitorState,
  config: MonitorConfig,
  blockNumber: bigint,
  onBlobFound: (blob: ProcessingJob) => Promise<void>
): Promise<void> => {
  try {
    const block = await state.client.getBlock({
      blockNumber,
      includeTransactions: true
    })
    
    const blobTxs = await processBlock(block, config.baseContracts)
    
    // Queue blob processing jobs
    for (const tx of blobTxs) {
      await onBlobFound({
        txHash: tx.hash,
        blockNumber: tx.blockNumber,
        blockHash: tx.blockHash,
        timestamp: tx.timestamp,
        blobVersionedHashes: tx.blobVersionedHashes,
        from: tx.from
      })
    }
  } catch (error) {
    logger.error(`Error processing block ${blockNumber}:`, error)
    throw error
  }
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => 
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      resolve()
    })
  }) 