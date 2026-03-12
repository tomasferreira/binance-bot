import { config } from './config.js'
import { logger } from './logger.js'
import { getTradingExchange, getDataExchange } from './exchange.js'
import { getMarketDataSource } from './marketDataSource.js'
import { loadState, saveState, migrateLegacyState } from './stateMulti.js'
import { loadRunner } from './runner.js'
import { STRATEGY_IDS, evaluateStrategy, getStrategyTimeframe } from './strategies/registry.js'
import { applyStopTakeProfitExits, openLongPosition, openShortPosition, closePositionNow } from './tradeManager.js'
import { logOpenOrders } from './orders.js'
import { computeRegime } from './regime.js'

const { symbol, timeframe, pollIntervalMs } = config.trading

/** If global budget is set, each strategy gets an equal share for position sizing. Otherwise null = use full balance. */
function getStrategyBudget () {
  const g = config.trading.globalBudgetQuote
  if (!g || g <= 0) return null
  return g / STRATEGY_IDS.length
}

let lastTickAt = null
/** Per-timeframe last closed candle timestamp (for isNewClosedCandle). */
let lastClosedCandleTsByTf = {}
let currentBacktest = null
const lastDecisionByStrategy = {}

const BINANCE_KLINES_MAX = 1000

function timeframeMs (tf) {
  const m = (tf || '').match(/^(\d+)(m|h|d)$/)
  if (!m) return 60 * 1000
  const n = parseInt(m[1], 10)
  if (m[2] === 'm') return n * 60 * 1000
  if (m[2] === 'h') return n * 60 * 60 * 1000
  if (m[2] === 'd') return n * 24 * 60 * 60 * 1000
  return 60 * 1000
}

async function fetchMarketData (limit = 250, tf) {
  const useTf = tf ?? timeframe
  const source = getMarketDataSource()
  const exchange = source === 'testnet' ? getTradingExchange() : getDataExchange()
  if (limit <= BINANCE_KLINES_MAX) {
    logger.debug('exchange.fetchOHLCV request', { symbol, timeframe: useTf, limit })
    const ohlcv = await exchange.fetchOHLCV(symbol, useTf, undefined, limit)
    logger.debug('exchange.fetchOHLCV response', { candles: ohlcv.length })
    return ohlcv
  }
  const all = await fetchMarketDataChunked(limit, useTf)
  logger.debug('exchange.fetchOHLCV response (chunked)', { candles: all.length })
  return all
}

/** Fetches OHLCV for regime calculation only (separate timeframe, more bars). */
async function fetchRegimeData () {
  const source = getMarketDataSource()
  const exchange = source === 'testnet' ? getTradingExchange() : getDataExchange()
  const regimeTf = config.trading.regimeTimeframe || '1h'
  const regimeLimit = Math.min(Number.isFinite(config.trading.regimeCandles) ? config.trading.regimeCandles : 200, BINANCE_KLINES_MAX)
  logger.debug('exchange.fetchOHLCV request (regime)', { symbol, timeframe: regimeTf, limit: regimeLimit })
  const ohlcv = await exchange.fetchOHLCV(symbol, regimeTf, undefined, regimeLimit)
  logger.debug('exchange.fetchOHLCV response (regime)', { candles: ohlcv.length })
  return ohlcv
}

async function fetchMarketDataChunked (requestedLimit, tf) {
  const useTf = tf ?? timeframe
  const source = getMarketDataSource()
  const exchange = source === 'testnet' ? getTradingExchange() : getDataExchange()
  const periodMs = timeframeMs(useTf)
  let ohlcv = await exchange.fetchOHLCV(symbol, useTf, undefined, BINANCE_KLINES_MAX)
  if (ohlcv.length === 0) return ohlcv
  const result = [...ohlcv]
  while (result.length < requestedLimit) {
    const firstTs = result[0][0]
    const since = firstTs - BINANCE_KLINES_MAX * periodMs
    const older = await exchange.fetchOHLCV(symbol, useTf, since, BINANCE_KLINES_MAX)
    const beforeFirst = older.filter(c => c[0] < firstTs)
    if (beforeFirst.length === 0) break
    result.unshift(...beforeFirst)
    if (beforeFirst.length < BINANCE_KLINES_MAX) break
  }
  return result.slice(-requestedLimit)
}

/** Returns full regime object or null if regime data unavailable. */
async function getRegime () {
  try {
    const regimeOhlcv = await fetchRegimeData()
    return computeRegime(regimeOhlcv)
  } catch (err) {
    logger.warn('getRegime failed', { err: err.message })
    return null
  }
}

/** @param ohlcv - Closed candles only (last forming candle excluded); lastClose is current price for SL/TP and orders. */
async function tickStrategy (strategyId, ohlcv, lastClose, context = {}) {
  let state = loadState(strategyId)
  const autoTradingEnabled = state.autoTradingEnabled !== false
  const isNewClosedCandle = context?.isNewClosedCandle === true
  const useCloseOnlyExits = config.trading.closeOnlyExits === true

  logger.debug('tickStrategy start', {
    strategyId,
    lastClose,
    autoTradingEnabled,
    hasOpenPosition: !!state.openPosition,
    side: state.openPosition?.side || null
  })

  // SL/TP handling:
  // - Default (closeOnlyExits = false): check on every tick using current price.
  // - closeOnlyExits = true: check only once per newly closed candle, using the
  //   closed candle's close price instead of the live lastClose.
  if (!useCloseOnlyExits || isNewClosedCandle) {
    const stopPrice = useCloseOnlyExits && Array.isArray(ohlcv) && ohlcv.length
      ? ohlcv[ohlcv.length - 1][4]
      : lastClose
    state = await applyStopTakeProfitExits(state, stopPrice, strategyId)
  }

  // Strategy entry/exit signals are evaluated only when a new candle has closed.
  // Between closes, ohlcv contains the same closed-bar history, so recomputing
  // the same decision each poll is wasted work and noisy in logs.
  if (!isNewClosedCandle) {
    saveState(strategyId, state)
    logger.debug('tickStrategy end (no new candle)', {
      strategyId,
      hasOpenPosition: !!state.openPosition,
      side: state.openPosition?.side || null
    })
    return state
  }

  if (state.openPosition) {
    const decision = evaluateStrategy(strategyId, ohlcv, state, context)
    lastDecisionByStrategy[strategyId] = decision.action
    const side = state.openPosition?.side || 'long'
    const wantsExitLong = side === 'long' && decision.action === 'exit-long'
    const wantsExitShort = side === 'short' && decision.action === 'exit-short'
    if (wantsExitLong || wantsExitShort) {
      const reason = wantsExitShort ? 'Strategy short exit' : 'Strategy exit'
      state = await closePositionNow(state, lastClose, strategyId, reason, decision.detail)
    } else {
      lastDecisionByStrategy[strategyId] = 'manage-open-position'
    }
  } else {
    const decision = evaluateStrategy(strategyId, ohlcv, state, context)
    lastDecisionByStrategy[strategyId] = decision.action
    if (autoTradingEnabled && decision.action === 'enter-long') {
      state = await openLongPosition(state, lastClose, strategyId, decision.detail, getStrategyBudget())
    } else if (autoTradingEnabled && decision.action === 'enter-short') {
      state = await openShortPosition(state, lastClose, strategyId, decision.detail, getStrategyBudget())
    } else if (decision.action === 'exit-long' || decision.action === 'exit-short') {
      // already flat, nothing to do
    }
  }

  saveState(strategyId, state)
  logger.debug('tickStrategy end', {
    strategyId,
    lastDecision: lastDecisionByStrategy[strategyId],
    hasOpenPosition: !!state.openPosition,
    side: state.openPosition?.side || null
  })
  return state
}

async function botTick () {
  try {
    logger.info('--- Bot tick start ---')
    const runner = loadRunner()
    const primaryTf = timeframe
    const uniqueTfs = new Set([
      primaryTf,
      ...runner.running.map((id) => getStrategyTimeframe(id, primaryTf))
    ])
    const [ohlcvByTf, regime] = await Promise.all([
      (async () => {
        const out = {}
        await Promise.all(
          [...uniqueTfs].map(async (tf) => {
            out[tf] = await fetchMarketData(250, tf)
          })
        )
        return out
      })(),
      getRegime()
    ])
    const primaryOhlcv = ohlcvByTf[primaryTf] || []
    // Last candle close = current price at poll time; same for any TF (we use primary for consistency).
    const lastClose = primaryOhlcv.length ? primaryOhlcv[primaryOhlcv.length - 1][4] : null
    const isNewClosedCandleByTf = {}
    for (const tf of uniqueTfs) {
      const arr = ohlcvByTf[tf] || []
      const closed = arr.length > 1 ? arr.slice(0, -1) : arr
      const latestClosedTs = closed.length ? closed[closed.length - 1][0] : null
      const isNew = latestClosedTs != null && latestClosedTs !== lastClosedCandleTsByTf[tf]
      isNewClosedCandleByTf[tf] = isNew
      if (latestClosedTs != null) lastClosedCandleTsByTf[tf] = latestClosedTs
    }
    const sampleId = STRATEGY_IDS[0]
    const sampleState = sampleId ? loadState(sampleId) : null
    const globalAutoTradingEnabled = sampleState ? sampleState.autoTradingEnabled !== false : true
    if (!globalAutoTradingEnabled) {
      logger.warn('Auto trading is OFF globally (no strategies will open/close positions automatically this tick)')
    }
    logger.debug('botTick state', {
      runningStrategies: runner.running,
      lastClose,
      regimeFilterEnabled: runner.regimeFilterEnabled !== false,
      globalAutoTradingEnabled,
      timeframes: [...uniqueTfs]
    })

    for (const strategyId of runner.running) {
      try {
        const tf = getStrategyTimeframe(strategyId, primaryTf)
        const arr = ohlcvByTf[tf] || []
        const ohlcvClosed = arr.length > 1 ? arr.slice(0, -1) : arr
        const context = {
          regime: regime || undefined,
          regimeFilterEnabled: runner.regimeFilterEnabled !== false,
          isNewClosedCandle: isNewClosedCandleByTf[tf] === true,
          timeframe: tf
        }
        await tickStrategy(strategyId, ohlcvClosed, lastClose, context)
      } catch (err) {
        logger.error(`Error in strategy ${strategyId}`, err)
      }
    }

    await logOpenOrders()
    lastTickAt = new Date().toISOString()
    logger.info('--- Bot tick end ---')
  } catch (err) {
    logger.error('Error in bot tick', err)
  }
}

function applyStartupFlags () {
  const argv = process.argv.slice(2)
  const autoOff = argv.includes('--auto-off') || argv.includes('--no-auto')
  const autoOn = argv.includes('--auto-on')
  if (autoOff || autoOn) {
    const value = autoOn || !autoOff ? true : false
    for (const id of STRATEGY_IDS) {
      const state = loadState(id)
      state.autoTradingEnabled = value
      saveState(id, state)
    }
    logger.info(`Startup flag: set autoTradingEnabled=${value} for all strategies`)
  }
}

async function run () {
  migrateLegacyState(STRATEGY_IDS[0])
  applyStartupFlags()
  logger.info(`Starting multi-strategy bot on ${symbol} (${timeframe}), interval=${pollIntervalMs}ms`)
  const runner = loadRunner()
  logger.info(`Running strategies: ${runner.running.join(', ') || 'none'}`)

  try {
    const exchange = getTradingExchange()
    const status = await exchange.fetchStatus()
    logger.info(`Exchange status: ${status.status}`)
  } catch (err) {
    logger.warn('Could not fetch exchange status', err)
  }

  await botTick()
  setInterval(async () => {
    await botTick()
  }, pollIntervalMs)
}

// --- Public API for HTTP layer ---

export function getCurrentBacktest () {
  return currentBacktest
}

export function setCurrentBacktest (value) {
  currentBacktest = value
}

export function getLastTickAt () {
  return lastTickAt
}

export function getLastDecisionByStrategy () {
  return lastDecisionByStrategy
}

export {
  run,
  fetchMarketData,
  fetchRegimeData,
  getStrategyBudget,
  pollIntervalMs,
  symbol,
  timeframe
}
