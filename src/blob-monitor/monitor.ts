import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import type { MonitorConfig, MonitorState, ProcessingJob } from './types.js'
import type { Database } from '../database/types.js'
import { createMonitorStateRepository } from '../database/repositories/monitor-state.js'
import { createProcessingJobsForBlock } from './block-processor.js'
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
  let lastProcessedBlock = await stateRepo.getLastProcessedBlock()

  if (lastProcessedBlock === 0n && config.blocksFromHead !== undefined && config.blocksFromHead > 0) {
    try {
      const latestBlock = await client.getBlockNumber()
      const calculatedStartBlock = latestBlock - BigInt(config.blocksFromHead)
      lastProcessedBlock = calculatedStartBlock > 0n ? calculatedStartBlock : 0n
      logger.info(`[Monitor] No previous state found. Starting from ${config.blocksFromHead} blocks behind head: new lastProcessedBlock is ${lastProcessedBlock}`)
    } catch (error) {
      logger.error("[Monitor] Failed to fetch latest block to calculate startBlock from blocksFromHead. Defaulting lastProcessedBlock to 0.", error)
      lastProcessedBlock = 0n
    }
  } else if (lastProcessedBlock === 0n) {
    logger.info("[Monitor] No previous state and no BLOCKS_FROM_HEAD configured (or is 0). Monitor will start processing from block 0 or wait for target block > 0.")
  } else {
    logger.info(`[Monitor] Resuming from last processed block: ${lastProcessedBlock}`)
  }
  
  return {
    isRunning: false,
    lastProcessedBlock,
    client,
    monitorId: 'default-monitor'
  }
}

const processBlockNumber = async (
  state: MonitorState,
  config: MonitorConfig,
  blockNumber: bigint,
  onBlobFound: (job: ProcessingJob) => Promise<void>
): Promise<void> => {
  try {
    const block = await state.client.getBlock({
      blockNumber,
      includeTransactions: true
    })
    
    const jobs = await createProcessingJobsForBlock(block, {
      baseContracts: config.baseContracts,
      l2Source: config.l2Source 
    });
    
    for (const job of jobs) {
      await onBlobFound(job)
    }
  } catch (error) {
    logger.error(`Error processing block ${blockNumber}:`, error)
    throw error
  }
}

const processBlockRange = async (
  state: MonitorState,
  config: MonitorConfig,
  fromBlock: bigint,
  toBlock: bigint,
  onBlobFound: (blob: ProcessingJob) => Promise<void>
): Promise<bigint> => {
  const batchSize = config.batchSize || 10
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

const sleep = (ms: number, signal?: AbortSignal): Promise<void> => 
  new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      resolve()
    })
  })

export const startMonitor = async (
  config: MonitorConfig,
  state: MonitorState,
  db: Database,
  onBlobFound: (blob: ProcessingJob) => Promise<void>
): Promise<() => void> => {
  let currentState = { ...state, isRunning: true }
  const stateRepo = createMonitorStateRepository(db)
  
  // Start monitoring loop
  const abortController = new AbortController()
  
  const monitorLoop = async () => {
    while (!abortController.signal.aborted) {
      try {
        const latestBlock = await currentState.client.getBlockNumber()
        const targetBlock = latestBlock - BigInt(config.confirmations || 3)
        
        if (currentState.lastProcessedBlock < targetBlock) {
          const fromBlock = currentState.lastProcessedBlock + 1n
          const maxBlocks = fromBlock + 99n
          const toBlock = maxBlocks < targetBlock ? maxBlocks : targetBlock // Limit range to 100 blocks
          
          logger.info(`Processing blocks ${fromBlock} to ${toBlock} (latest: ${latestBlock})`)
          
          const processedBlock = await processBlockRange(
            currentState,
            config,
            fromBlock,
            toBlock,
            onBlobFound
          )
          
          currentState = { ...currentState, lastProcessedBlock: processedBlock }
          await stateRepo.updateLastProcessedBlock(processedBlock)
          
          logger.info(`Completed processing up to block ${processedBlock}`)
        } else {
          logger.debug(`Waiting for new blocks... (current: ${currentState.lastProcessedBlock}, target: ${targetBlock})`)
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