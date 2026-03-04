import { logger } from './logger.js'
import { config } from './config.js'

// 'live' = Binance mainnet public data, 'testnet' = Binance sandbox/testnet data.
const initialSource = config.marketData?.defaultSource === 'testnet' ? 'testnet' : 'live'
let currentSource = initialSource

export function getMarketDataSource () {
  return currentSource
}

export function setMarketDataSource (value) {
  const v = (value || '').toLowerCase()
  if (v !== 'live' && v !== 'testnet') {
    throw new Error(`Invalid market data source: ${value}`)
  }
  if (v === currentSource) return
  currentSource = v
  logger.info(`Market data source switched to ${currentSource.toUpperCase()}`)
}

