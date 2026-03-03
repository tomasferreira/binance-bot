import { spawn } from 'child_process'
import express from 'express'
import { config } from './config.js'
import { logger } from './logger.js'
import { getExchange } from './exchange.js'
import { loadState, saveState, migrateLegacyState, resetPnlState } from './stateMulti.js'
import { loadRunner, setRunning, setRegimeFilterEnabled, setAllRunning } from './runner.js'
import { STRATEGY_IDS, getStrategy, evaluateStrategy, isRegimeActive } from './strategies/registry.js'
import { getOrderStrategyMap } from './orderStrategy.js'
import { maybeClosePosition, openLongPosition, openShortPosition, closePositionNow } from './tradeManager.js'
import { logOpenOrders } from './orders.js'
import { getEMACrossSignal, calculateEMA, calculateMACD, calculateRSI, calculateBollinger, calculateATR, calculateADX } from './indicators.js'
import { computeRegime } from './regime.js'
import { getEffectiveTradingConfig, computeUnrealizedPnl } from './runtimeConfig.js'
import { buildStatusPayload } from './status.js'

const { symbol, timeframe, pollIntervalMs } = config.trading
const apiPort = config.http.apiPort

// Prevent macOS from sleeping while the bot is running
let caffeinateChild = null
if (process.platform === 'darwin') {
  // -i = prevent idle sleep (AC and battery), -d = prevent display sleep (keeps system awake on battery)
  caffeinateChild = spawn('caffeinate', ['-i', '-d'], { stdio: 'ignore' })
  caffeinateChild.on('error', () => {})
  process.on('exit', () => { if (caffeinateChild) caffeinateChild.kill() })
}

/** If global budget is set, each strategy gets an equal share for position sizing. Otherwise null = use full balance. */
function getStrategyBudget () {
  const g = config.trading.globalBudgetQuote
  if (!g || g <= 0) return null
  return g / STRATEGY_IDS.length
}

let lastTickAt = null
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

async function fetchMarketData (limit = 250) {
  const exchange = getExchange()
  if (limit <= BINANCE_KLINES_MAX) {
    logger.debug('exchange.fetchOHLCV request', { symbol, timeframe, limit })
    const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit)
    logger.debug('exchange.fetchOHLCV response', { candles: ohlcv.length })
    return ohlcv
  }
  const all = await fetchMarketDataChunked(limit)
  logger.debug('exchange.fetchOHLCV response (chunked)', { candles: all.length })
  return all
}

/** Fetches OHLCV for regime calculation only (separate timeframe, more bars). */
async function fetchRegimeData () {
  const exchange = getExchange()
  const regimeTf = config.trading.regimeTimeframe || '1h'
  const regimeLimit = Math.min(config.trading.regimeCandles ?? 200, BINANCE_KLINES_MAX)
  logger.debug('exchange.fetchOHLCV request (regime)', { symbol, timeframe: regimeTf, limit: regimeLimit })
  const ohlcv = await exchange.fetchOHLCV(symbol, regimeTf, undefined, regimeLimit)
  logger.debug('exchange.fetchOHLCV response (regime)', { candles: ohlcv.length })
  return ohlcv
}

async function fetchMarketDataChunked (requestedLimit) {
  const exchange = getExchange()
  const periodMs = timeframeMs(timeframe)
  let ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, BINANCE_KLINES_MAX)
  if (ohlcv.length === 0) return ohlcv
  const result = [...ohlcv]
  while (result.length < requestedLimit) {
    const firstTs = result[0][0]
    const since = firstTs - BINANCE_KLINES_MAX * periodMs
    const older = await exchange.fetchOHLCV(symbol, timeframe, since, BINANCE_KLINES_MAX)
    const beforeFirst = older.filter(c => c[0] < firstTs)
    if (beforeFirst.length === 0) break
    result.unshift(...beforeFirst)
    if (beforeFirst.length < BINANCE_KLINES_MAX) break
  }
  return result.slice(-requestedLimit)
}

/** Returns { volatility, trend, trendDirection } or null if regime data unavailable. */
async function getRegime () {
  try {
    const regimeOhlcv = await fetchRegimeData()
    const computed = computeRegime(regimeOhlcv)
    return computed ? { volatility: computed.volatility, trend: computed.trend, trendDirection: computed.trendDirection } : null
  } catch (err) {
    logger.warn('getRegime failed', { err: err.message })
    return null
  }
}

/** @param ohlcv - Closed candles only (last forming candle excluded); lastClose is current price for SL/TP and orders. */
async function tickStrategy (strategyId, ohlcv, lastClose, context = {}) {
  let state = loadState(strategyId)
  const autoTradingEnabled = state.autoTradingEnabled !== false
  logger.debug('tickStrategy start', {
    strategyId,
    lastClose,
    autoTradingEnabled,
    hasOpenPosition: !!state.openPosition,
    side: state.openPosition?.side || null
  })

  state = await maybeClosePosition(state, lastClose, strategyId)

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
    const [ohlcv, regime] = await Promise.all([fetchMarketData(), getRegime()])
    const lastClose = ohlcv[ohlcv.length - 1][4]
    // Strategy entry/exit signals use only closed candles; current price (lastClose) is used for SL/TP and orders
    const ohlcvClosed = ohlcv.length > 1 ? ohlcv.slice(0, -1) : ohlcv
    const runner = loadRunner()
    // Global view of auto-trading: we treat it as OFF if the first strategy's
    // state has autoTradingEnabled === false (dashboard toggle updates all).
    const sampleId = STRATEGY_IDS[0]
    const sampleState = sampleId ? loadState(sampleId) : null
    const globalAutoTradingEnabled = sampleState ? sampleState.autoTradingEnabled !== false : true
    if (!globalAutoTradingEnabled) {
      logger.warn('Auto trading is OFF globally (no strategies will open/close positions automatically this tick)')
    }
    const context = {
      regime: regime || undefined,
      regimeFilterEnabled: runner.regimeFilterEnabled !== false
    }
    logger.debug('botTick state', {
      runningStrategies: runner.running,
      lastClose,
      regimeFilterEnabled: context.regimeFilterEnabled,
      globalAutoTradingEnabled
    })

    for (const strategyId of runner.running) {
      try {
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

async function main () {
  migrateLegacyState(STRATEGY_IDS[0])
  applyStartupFlags()
  logger.info(`Starting multi-strategy bot on ${symbol} (${timeframe}), interval=${pollIntervalMs}ms`)
  const runner = loadRunner()
  logger.info(`Running strategies: ${runner.running.join(', ') || 'none'}`)

  try {
    const exchange = getExchange()
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

// --- HTTP API & Dashboard ---

const app = express()
app.use(express.json())

// Inbound API debug logging: request + response (body + headers) when LOG_LEVEL=DEBUG
app.use((req, res, next) => {
  logger.debug('HTTP inbound', {
    method: req.method,
    url: req.originalUrl || req.url,
    headers: req.headers,
    body: req.body
  })

  const origJson = res.json.bind(res)
  const origSend = res.send.bind(res)

  res.json = (body) => {
    logger.debug('HTTP outbound', {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      body
    })
    return origJson(body)
  }

  res.send = (body) => {
    logger.debug('HTTP outbound', {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      body: typeof body === 'string' ? body.slice(0, 2000) : body
    })
    return origSend(body)
  }

  next()
})

// Status endpoint used by the dashboard
app.get('/api/status', async (req, res) => {
  try {
    logger.debug('HTTP GET /api/status')
    const runner = loadRunner()
    const exchange = getExchange()
    logger.debug('exchange.fetchBalance request (/api/status)', { symbol })
    const balance = await exchange.fetchBalance()
    logger.debug('exchange.fetchBalance response (/api/status)', {
      total: balance.total,
      free: balance.free,
      used: balance.used
    })

    const ohlcv = await fetchMarketData(250)
    const last = ohlcv[ohlcv.length - 1]
    const lastPrice = last?.[4] ?? null
    const { fast: ema50, slow: ema200 } = getEMACrossSignal(ohlcv)
    const closes = ohlcv.map(c => c[4])
    const ema9Arr = calculateEMA(closes, 9)
    const ema20Arr = calculateEMA(closes, 20)
    const ema21Arr = calculateEMA(closes, 21)
    const { macdLine, signalLine } = calculateMACD(closes, 12, 26, 9)
    const lastIdx = closes.length - 1
    const ema9 = ema9Arr[lastIdx] ?? null
    const ema20 = ema20Arr[lastIdx] ?? null
    const ema21 = ema21Arr[lastIdx] ?? null
    const macd = macdLine[lastIdx] ?? null
    const macdSignal = signalLine[lastIdx] ?? null

    const lookback = Math.min(20, ohlcv.length)
    let volumeLast = null
    let volumeAvg20 = null
    let recentHigh20 = null
    let recentLow20 = null
    if (ohlcv.length >= 1) {
      volumeLast = ohlcv[ohlcv.length - 1][5] ?? null
      if (lookback >= 1) {
        const volSlice = ohlcv.slice(-lookback).map(c => c[5] ?? 0)
        volumeAvg20 = volSlice.reduce((a, b) => a + b, 0) / volSlice.length
        recentHigh20 = Math.max(...ohlcv.slice(-lookback).map(c => c[2] ?? 0))
        recentLow20 = Math.min(...ohlcv.slice(-lookback).map(c => c[3] ?? Infinity))
      }
    }

    const regimeTf = config.trading.regimeTimeframe || '1h'
    const regimeCandles = config.trading.regimeCandles ?? 200
    let regime = { volatility: 'neutral', trend: 'weak', trendDirection: 'neutral' }
    let volatilityRatio = null
    let adxNow = null
    let plusDiNow = null
    let minusDiNow = null
    try {
      const regimeOhlcv = await fetchRegimeData()
      const computed = computeRegime(regimeOhlcv)
      if (computed) {
        regime = { volatility: computed.volatility, trend: computed.trend, trendDirection: computed.trendDirection }
        volatilityRatio = computed.volatilityRatio ?? null
        adxNow = computed.adxNow ?? null
        plusDiNow = computed.plusDiNow ?? null
        minusDiNow = computed.minusDiNow ?? null
      }
    } catch (err) {
      logger.warn('Regime fetch or calculation failed', { err: err.message })
    }

    logger.debug('exchange.fetchOpenOrders request (/api/status)', { symbol })
    const openOrders = await exchange.fetchOpenOrders(symbol)
    logger.debug('exchange.fetchOpenOrders response (/api/status)', { count: openOrders.length })
    const payload = buildStatusPayload({
      runner,
      lastDecisionByStrategy,
      loadState,
      getStrategy,
      STRATEGY_IDS,
      isRegimeActive,
      config,
      getStrategyBudget,
      getEffectiveTradingConfig,
      lastTickAt,
      pollIntervalMs,
      symbol,
      balance,
      lastPrice,
      ema9,
      ema20,
      ema21,
      ema50,
      ema200,
      macd,
      macdSignal,
      regime,
      volatilityRatio,
      adxNow,
      plusDiNow,
      minusDiNow,
      regimeTf,
      regimeCandles,
      openOrders,
      volumeLast,
      volumeAvg20,
      recentHigh20,
      recentLow20
    })
    res.json(payload)
  } catch (err) {
    logger.error('Error in /api/status', err)
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// Manual buy: portfolio (amount + unit) or open full risk-sized position
app.post('/api/manual-buy', async (req, res) => {
  try {
    const { amount: amountParam, unit } = req.body || {}
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]

    if (typeof amountParam === 'number' && amountParam > 0 && (unit === 'base' || unit === 'quote')) {
      const amountBase = unit === 'quote' ? amountParam / lastClose : amountParam
      const exchange = getExchange()
      logger.info(`Manual portfolio BUY: ${amountBase} base (${unit === 'quote' ? amountParam + ' quote' : 'base'})`)
      const order = await exchange.createMarketBuyOrder(symbol, amountBase)
      logger.info(`Market BUY order placed: id=${order.id}, status=${order.status}`)
      return res.json({ status: 'ok', order: { id: order.id, status: order.status }, amountBase })
    }

    const strategyId = 'manual'
    let state = loadState(strategyId)
    logger.info('Manual BUY requested via API (full position)')
    state = await openLongPosition(state, lastClose, strategyId, null, getStrategyBudget())
    saveState(strategyId, state)
    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in /api/manual-buy', err)
    res.status(500).json({ error: 'Manual buy failed' })
  }
})

// Manual sell: portfolio (amount + unit) or close full manual position
app.post('/api/manual-sell', async (req, res) => {
  try {
    const { amount: amountParam, unit } = req.body || {}
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]

    if (typeof amountParam === 'number' && amountParam > 0 && (unit === 'base' || unit === 'quote')) {
      const amountBase = unit === 'quote' ? amountParam / lastClose : amountParam
      const exchange = getExchange()
      logger.info(`Manual portfolio SELL: ${amountBase} base (${unit === 'quote' ? amountParam + ' quote' : 'base'})`)
      const order = await exchange.createMarketSellOrder(symbol, amountBase)
      logger.info(`Market SELL order placed: id=${order.id}, status=${order.status}`)
      return res.json({ status: 'ok', order: { id: order.id, status: order.status }, amountBase })
    }

    const strategyId = 'manual'
    let state = loadState(strategyId)
    if (!state.openPosition) {
      return res.json({ status: 'ok', position: null })
    }
    logger.info('Manual SELL requested via API (close position)')
    state = await closePositionNow(state, lastClose, strategyId, 'Manual close')
    saveState(strategyId, state)
    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in /api/manual-sell', err)
    res.status(500).json({ error: 'Manual sell failed' })
  }
})

// List strategies and start/stop
app.get('/api/strategies', (req, res) => {
  logger.debug('HTTP GET /api/strategies')
  const runner = loadRunner()
  const list = STRATEGY_IDS.map(id => ({
    id,
    name: getStrategy(id)?.name ?? id,
    running: runner.running.includes(id)
  }))
  res.json({ strategies: list })
})

app.post('/api/strategies/:id/start', (req, res) => {
  try {
    const { id } = req.params
    logger.debug('HTTP POST /api/strategies/:id/start', { id })
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    const runner = setRunning(id, true)
    res.json({ status: 'ok', running: runner.running })
  } catch (err) {
    logger.error('Error starting strategy', err)
    res.status(500).json({ error: 'Failed to start' })
  }
})

app.post('/api/strategies/:id/stop', (req, res) => {
  try {
    const { id } = req.params
    logger.debug('HTTP POST /api/strategies/:id/stop', { id })
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    const runner = setRunning(id, false)
    res.json({ status: 'ok', running: runner.running })
  } catch (err) {
    logger.error('Error stopping strategy', err)
    res.status(500).json({ error: 'Failed to stop' })
  }
})

app.post('/api/strategies/start-all', (req, res) => {
  try {
    logger.debug('HTTP POST /api/strategies/start-all')
    const runner = setAllRunning(true)
    res.json({ status: 'ok', running: runner.running })
  } catch (err) {
    logger.error('Error starting all strategies', err)
    res.status(500).json({ error: 'Failed to start all' })
  }
})

app.post('/api/strategies/stop-all', (req, res) => {
  try {
    logger.debug('HTTP POST /api/strategies/stop-all')
    const runner = setAllRunning(false)
    res.json({ status: 'ok', running: runner.running })
  } catch (err) {
    logger.error('Error stopping all strategies', err)
    res.status(500).json({ error: 'Failed to stop all' })
  }
})

// Open a long position for a specific strategy
app.post('/api/strategies/:id/buy', async (req, res) => {
  try {
    const { id } = req.params
    logger.debug('HTTP POST /api/strategies/:id/buy', { id })
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    let state = loadState(id)
    if (state.openPosition) {
      return res.status(400).json({ error: 'Strategy already has an open position', position: state.openPosition })
    }
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]
    logger.info(`Strategy BUY requested via API: ${id}`)
    state = await openLongPosition(state, lastClose, id, null, getStrategyBudget())
    saveState(id, state)
    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in strategy buy', err)
    res.status(500).json({ error: 'Buy failed' })
  }
})

// Open a short position for a specific strategy
app.post('/api/strategies/:id/short', async (req, res) => {
  try {
    const { id } = req.params
    logger.debug('HTTP POST /api/strategies/:id/short', { id })
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    let state = loadState(id)
    if (state.openPosition) {
      return res.status(400).json({ error: 'Strategy already has an open position', position: state.openPosition })
    }
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]
    logger.info(`Strategy SHORT requested via API: ${id}`)
    state = await openShortPosition(state, lastClose, id, null, getStrategyBudget())
    saveState(id, state)
    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in strategy short', err)
    res.status(500).json({ error: 'Short failed' })
  }
})

// Close all open positions (all strategies)
app.post('/api/close-all', async (req, res) => {
  try {
    logger.debug('HTTP POST /api/close-all')
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]
    const closed = []
    for (const id of STRATEGY_IDS) {
      let state = loadState(id)
      if (!state.openPosition) continue
      logger.info(`Close-all: closing position for strategy ${id}`)
      state = await closePositionNow(state, lastClose, id, 'Close all')
      saveState(id, state)
      closed.push(id)
    }
    logger.info('Close-all finished', { closed: closed.length, strategies: closed })
    res.json({ status: 'ok', closed: closed.length, strategies: closed })
  } catch (err) {
    logger.error('Error in close-all', err)
    res.status(500).json({ error: 'Close all failed' })
  }
})

// Close position for a specific strategy
app.post('/api/strategies/:id/sell', async (req, res) => {
  try {
    const { id } = req.params
    logger.debug('HTTP POST /api/strategies/:id/sell', { id })
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    let state = loadState(id)
    if (!state.openPosition) {
      return res.json({ status: 'ok', position: null, message: 'No position to close' })
    }
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]
    logger.info(`Strategy SELL requested via API: ${id}`)
    state = await closePositionNow(state, lastClose, id, 'Manual close')
    saveState(id, state)
    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in strategy sell', err)
    res.status(500).json({ error: 'Sell failed' })
  }
})

// Reset realized PnL and stats for one strategy
app.post('/api/strategies/:id/reset-pnl', (req, res) => {
  try {
    const { id } = req.params
    logger.debug('HTTP POST /api/strategies/:id/reset-pnl', { id })
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    const state = resetPnlState(loadState(id))
    saveState(id, state)
    logger.info(`PnL + win/loss counters + trade history reset for strategy: ${id}`)
    res.json({
      status: 'ok',
      realizedPnl: 0,
      wins: 0,
      losses: 0,
      positionsOpened: 0
    })
  } catch (err) {
    logger.error('Error resetting PnL', err)
    res.status(500).json({ error: 'Reset failed' })
  }
})

// Reset realized PnL and stats for all strategies
app.post('/api/reset-all-pnl', (req, res) => {
  try {
    logger.debug('HTTP POST /api/reset-all-pnl')
    for (const id of STRATEGY_IDS) {
      saveState(id, resetPnlState(loadState(id)))
    }
    logger.info('PnL + win/loss counters + trade history reset for all strategies')
    res.json({ status: 'ok' })
  } catch (err) {
    logger.error('Error resetting all PnL', err)
    res.status(500).json({ error: 'Reset failed' })
  }
})

// Runtime config update endpoint (applies to all strategies' state)
app.post('/api/config', (req, res) => {
  try {
    const { autoTradingEnabled, riskPerTrade, stopLossPct, takeProfitPct } = req.body || {}
    logger.debug('HTTP POST /api/config', { autoTradingEnabled, riskPerTrade, stopLossPct, takeProfitPct })

    for (const id of STRATEGY_IDS) {
      let state = loadState(id)
      if (typeof autoTradingEnabled === 'boolean') {
        state.autoTradingEnabled = autoTradingEnabled
      }
      state.runtimeConfig = {
        ...(state.runtimeConfig || {}),
        ...(typeof riskPerTrade === 'number' ? { riskPerTrade } : {}),
        ...(typeof stopLossPct === 'number' ? { stopLossPct } : {}),
        ...(typeof takeProfitPct === 'number' ? { takeProfitPct } : {})
      }
      saveState(id, state)
    }

    const firstState = loadState(STRATEGY_IDS[0])
    const effective = getEffectiveTradingConfig(firstState)
    logger.info(
      `Runtime config updated via API: riskPerTrade=${effective.riskPerTrade}, ` +
        `stopLossPct=${effective.stopLossPct}, takeProfitPct=${effective.takeProfitPct}`
    )

    res.json({
      status: 'ok',
      runtimeConfig: firstState.runtimeConfig
    })
  } catch (err) {
    logger.error('Error in /api/config', err)
    res.status(500).json({ error: 'Failed to update config' })
  }
})

app.post('/api/config/regime-filter', (req, res) => {
  try {
    const { enabled } = req.body || {}
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Body must include { enabled: true|false }' })
    }
    setRegimeFilterEnabled(enabled)
    res.json({ status: 'ok', regimeFilterEnabled: enabled })
  } catch (err) {
    logger.error('Error in /api/config/regime-filter', err)
    res.status(500).json({ error: 'Failed to update regime filter' })
  }
})

// Reset risk/SL/TP to .env defaults (clears persisted runtime config)
app.post('/api/config/reset', (req, res) => {
  try {
    for (const id of STRATEGY_IDS) {
      const state = loadState(id)
      state.runtimeConfig = {
        ...(state.runtimeConfig || {}),
        riskPerTrade: null,
        stopLossPct: null,
        takeProfitPct: null
      }
      saveState(id, state)
    }
    const firstState = loadState(STRATEGY_IDS[0])
    const effective = getEffectiveTradingConfig(firstState)
    logger.info(
      `Runtime risk config reset to .env defaults: riskPerTrade=${effective.riskPerTrade}, ` +
        `stopLossPct=${effective.stopLossPct}, takeProfitPct=${effective.takeProfitPct}`
    )
    res.json({ status: 'ok', runtimeConfig: firstState.runtimeConfig })
  } catch (err) {
    logger.error('Error in /api/config/reset', err)
    res.status(500).json({ error: 'Failed to reset config' })
  }
})

// Recent trades with fee info (from Binance)
app.get('/api/trades', async (req, res) => {
  try {
    const exchange = getExchange()
    const limit = Math.min(Number(req.query.limit) || 50, 500)
    logger.debug('HTTP GET /api/trades', { limit })
    logger.debug('exchange.fetchMyTrades request', { symbol, limit })
    const trades = await exchange.fetchMyTrades(symbol, undefined, limit)
    logger.debug('exchange.fetchMyTrades response', { count: trades.length })
    const orderToStrategy = getOrderStrategyMap()

    const withFees = trades.map(t => {
      const orderId = t.order ?? t.orderId ?? null
      const raw = orderId ? orderToStrategy[String(orderId)] : null
      const strategyId = typeof raw === 'string' ? raw : (raw?.strategyId ?? null)
      const reason = typeof raw === 'object' && raw != null ? (raw.reason ?? null) : null
      const detail = typeof raw === 'object' && raw != null && raw.detail ? raw.detail : null
      const orderPnl = typeof raw === 'object' && raw != null && typeof raw.pnl === 'number' ? raw.pnl : null
      const strategy = strategyId ? getStrategy(strategyId) : null
      return {
        id: t.id,
        orderId,
        timestamp: t.timestamp,
        side: t.side,
        amount: t.amount,
        price: t.price,
        cost: t.cost,
        fee: t.fee ? { cost: t.fee.cost ?? 0, currency: t.fee.currency ?? 'USDT' } : null,
        strategyId: strategyId ?? null,
        strategyName: strategy?.name ?? strategyId ?? null,
        reason: reason ?? null,
        detail: detail ?? null,
        orderPnl
      }
    })

    const totalFeeUsdt = withFees.reduce((sum, t) => {
      if (t.fee && (t.fee.currency === 'USDT' || t.fee.currency === 'BNB')) {
        return sum + Number(t.fee.cost || 0)
      }
      return sum
    }, 0)

    res.json({
      trades: withFees.reverse(),
      totalFeeEstimate: totalFeeUsdt,
      feeCurrency: 'USDT'
    })
  } catch (err) {
    logger.error('Error in /api/trades', err)
    res.status(500).json({ error: 'Failed to fetch trades' })
  }
})

// Candles + EMA data for charting (max candles = closedTradesHistoryLimit so chart can show same range as analysis)
app.get('/api/candles', async (req, res) => {
  try {
    const maxCandles = config.trading.closedTradesHistoryLimit ?? 500
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 200), maxCandles)
    logger.debug('HTTP GET /api/candles', { limit })
    const ohlcv = await fetchMarketData(limit)

    // Sanitize: incomplete candles or bad ticks can have 0, wrong scale, or huge spikes
    let lastValidClose = null
    const closes = ohlcv.map(c => {
      const raw = Number(c[4])
      const invalid = !Number.isFinite(raw) || raw <= 0
      const outlier = lastValidClose != null && raw > 0 &&
        (raw < lastValidClose * 0.5 || raw > lastValidClose * 2)
      if (!invalid && !outlier) {
        lastValidClose = raw
        return raw
      }
      return lastValidClose ?? raw
    })

    const ema9 = calculateEMA(closes, 9)
    const ema20 = calculateEMA(closes, 20)
    const ema21 = calculateEMA(closes, 21)
    const ema50 = calculateEMA(closes, 50)
    const ema200 = calculateEMA(closes, 200)
    const { macdLine, signalLine, histogram } = calculateMACD(closes, 12, 26, 9)
    const rsi14 = calculateRSI(closes, 14)
    const { middle: bbMid, upper: bbUpper, lower: bbLower } = calculateBollinger(closes, 20, 2)

    const result = ohlcv.map((candle, idx) => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: closes[idx],
      volume: candle[5],
      ema9: ema9[idx] ?? null,
      ema20: ema20[idx] ?? null,
      ema21: ema21[idx] ?? null,
      ema50: ema50[idx] ?? null,
      ema200: ema200[idx] ?? null,
      macd: macdLine[idx] ?? null,
      macdSignal: signalLine[idx] ?? null,
      macdHistogram: histogram[idx] ?? null,
      rsi14: rsi14[idx] ?? null,
      bbMid: bbMid[idx] ?? null,
      bbUpper: bbUpper[idx] ?? null,
      bbLower: bbLower[idx] ?? null
    }))

    // Drop last candle so chart only shows closed candles (avoids incomplete 1m bar spike)
    const toSend = result.length > 1 ? result.slice(0, -1) : result
    res.json(toSend)
  } catch (err) {
    logger.error('Error in /api/candles', err)
    res.status(500).json({ error: 'Failed to fetch candles' })
  }
})

// Serve a very simple dashboard page
app.use(express.static(new URL('../public', import.meta.url).pathname))

async function start () {
  await main()

  app.listen(apiPort, () => {
    logger.info(`HTTP API & dashboard listening on http://localhost:${apiPort}`)
  })
}

start().catch(err => {
  logger.error('Fatal error in start()', err)
  process.exit(1)
})

