import ccxt from 'ccxt'
import { config } from './config.js'
import { logger } from './logger.js'

let exchangeInstance = null

export function getExchange () {
  if (exchangeInstance) return exchangeInstance

  const { apiKey, secret, testnet } = config.binance

  const options = {
    apiKey,
    secret,
    enableRateLimit: true
  }

  const exchange = new ccxt.binance(options)

  if (testnet) {
    exchange.setSandboxMode(true)
    logger.info('Binance exchange initialized in TESTNET (sandbox) mode')
  } else {
    logger.warn('Binance exchange initialized in LIVE mode. Be careful!')
  }

  exchangeInstance = exchange
  return exchangeInstance
}

