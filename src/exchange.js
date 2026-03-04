import ccxt from 'ccxt'
import { config } from './config.js'
import { logger } from './logger.js'

let tradingExchangeInstance = null
let dataExchangeInstance = null

/**
 * Exchange used for trading-related operations (balances, orders, positions).
 * Respects TESTNET flag from env/config.
 */
export function getTradingExchange () {
  if (tradingExchangeInstance) return tradingExchangeInstance

  const { apiKey, secret, testnet } = config.binance

  const options = {
    apiKey,
    secret,
    enableRateLimit: true
  }

  const exchange = new ccxt.binance(options)

  if (testnet) {
    exchange.setSandboxMode(true)
    logger.info('Binance TRADING exchange initialized in TESTNET (sandbox) mode')
  } else {
    logger.warn('Binance TRADING exchange initialized in LIVE mode. Be careful!')
  }

  tradingExchangeInstance = exchange
  return tradingExchangeInstance
}

/**
 * Exchange used for market data (candles, regime, backtests).
 * Always points to LIVE public endpoints; no sandbox/testnet.
 * Only public data methods (fetchOHLCV, etc.) should use this.
 */
export function getDataExchange () {
  if (dataExchangeInstance) return dataExchangeInstance

  const exchange = new ccxt.binance({
    enableRateLimit: true
  })

  logger.info('Binance DATA exchange initialized against LIVE endpoints (public market data only)')

  dataExchangeInstance = exchange
  return dataExchangeInstance
}

// Backwards-compatible alias: existing code that imports getExchange()
// will use the TRADING exchange (testnet-aware).
export function getExchange () {
  return getTradingExchange()
}

