import { config } from './config.js'
import { logger } from './logger.js'
import { getExchange } from './exchange.js'
import { loadState, saveState } from './state.js'
import { evaluateStrategy } from './strategy.js'
import { maybeClosePosition, openLongPosition } from './tradeManager.js'
import { logPortfolio } from './portfolio.js'

const { symbol, timeframe, pollIntervalMs } = config.trading

async function fetchMarketData (limit = 250) {
  const exchange = getExchange()
  const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit)
  return ohlcv
}

async function botTick () {
  let state = loadState()
  try {
    logger.info('--- Bot tick start ---')

    const ohlcv = await fetchMarketData()
    const lastClose = ohlcv[ohlcv.length - 1][4]

    // First manage existing position (SL/TP)
    state = await maybeClosePosition(state, lastClose)

    // Evaluate new signals only if flat
    if (!state.openPosition) {
      const decision = evaluateStrategy({ ohlcv, lastState: state })
      if (decision.action === 'enter-long') {
        state = await openLongPosition(state, lastClose)
      }
    }

    // Log portfolio and position each tick
    await logPortfolio(state)

    saveState(state)
    logger.info('--- Bot tick end ---')
  } catch (err) {
    logger.error('Error in bot tick', err)
  }
}

async function main () {
  logger.info(`Starting Binance EMA bot on ${symbol} (${timeframe}), interval=${pollIntervalMs}ms`)

  // Basic connectivity check
  try {
    const exchange = getExchange()
    const status = await exchange.fetchStatus()
    logger.info(`Exchange status: ${status.status}`)
  } catch (err) {
    logger.warn('Could not fetch exchange status', err)
  }

  // Log portfolio and any persisted position at startup
  await logPortfolio(loadState())

  // Initial immediate run
  await botTick()

  // Schedule loop
  setInterval(async () => {
    await botTick()
  }, pollIntervalMs)
}

main().catch(err => {
  logger.error('Fatal error in main()', err)
  process.exit(1)
})

