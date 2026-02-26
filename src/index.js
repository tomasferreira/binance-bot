import express from 'express'
import { config } from './config.js'
import { logger } from './logger.js'
import { getExchange } from './exchange.js'
import { loadState, saveState, migrateLegacyState } from './stateMulti.js'
import { loadRunner, setRunning } from './runner.js'
import { STRATEGY_IDS, getStrategy, evaluateStrategy } from './strategies/registry.js'
import { getOrderStrategyMap } from './orderStrategy.js'
import { maybeClosePosition, openLongPosition, openShortPosition, closePositionNow } from './tradeManager.js'
import { logOpenOrders } from './orders.js'
import { getEMACrossSignal, calculateEMA, calculateMACD, calculateRSI, calculateBollinger } from './indicators.js'

const { symbol, timeframe, pollIntervalMs } = config.trading
const apiPort = Number(process.env.API_PORT || 3000)

let lastTickAt = null
const lastDecisionByStrategy = {}

async function fetchMarketData (limit = 250) {
  const exchange = getExchange()
  const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit)
  return ohlcv
}

async function tickStrategy (strategyId, ohlcv, lastClose) {
  let state = loadState(strategyId)
  const autoTradingEnabled = state.autoTradingEnabled !== false

  state = await maybeClosePosition(state, lastClose, strategyId)

  if (state.openPosition) {
    const decision = evaluateStrategy(strategyId, ohlcv, state)
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
    const decision = evaluateStrategy(strategyId, ohlcv, state)
    lastDecisionByStrategy[strategyId] = decision.action
    if (autoTradingEnabled && decision.action === 'enter-long') {
      state = await openLongPosition(state, lastClose, strategyId, decision.detail)
    } else if (autoTradingEnabled && decision.action === 'enter-short') {
      state = await openShortPosition(state, lastClose, strategyId, decision.detail)
    } else if (decision.action === 'exit-long' || decision.action === 'exit-short') {
      // already flat, nothing to do
    }
  }

  saveState(strategyId, state)
  return state
}

async function botTick () {
  try {
    logger.info('--- Bot tick start ---')
    const ohlcv = await fetchMarketData()
    const lastClose = ohlcv[ohlcv.length - 1][4]
    const runner = loadRunner()

    for (const strategyId of runner.running) {
      try {
        await tickStrategy(strategyId, ohlcv, lastClose)
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

async function main () {
  migrateLegacyState(STRATEGY_IDS[0])
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

// Helper to compute effective runtime config
function getEffectiveTradingConfig (state) {
  const runtime = state.runtimeConfig || {}
  const riskPerTrade =
    typeof runtime.riskPerTrade === 'number' && runtime.riskPerTrade > 0
      ? runtime.riskPerTrade
      : config.trading.riskPerTrade
  const stopLossPct =
    typeof runtime.stopLossPct === 'number' && runtime.stopLossPct > 0
      ? runtime.stopLossPct
      : config.trading.stopLossPct
  const takeProfitPct =
    typeof runtime.takeProfitPct === 'number' && runtime.takeProfitPct > 0
      ? runtime.takeProfitPct
      : config.trading.takeProfitPct

  return { riskPerTrade, stopLossPct, takeProfitPct }
}

// Status endpoint used by the dashboard
app.get('/api/status', async (req, res) => {
  try {
    const runner = loadRunner()
    const exchange = getExchange()
    const balance = await exchange.fetchBalance()

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

    const openOrders = await exchange.fetchOpenOrders(symbol)
    const now = Date.now()

    const strategies = STRATEGY_IDS.map(id => {
      const state = loadState(id)
      const s = getStrategy(id)
      const realized = Number(state.realizedPnl ?? 0)
      let unrealized = 0
      if (state.openPosition && lastPrice != null) {
        const { side, entryPrice, amount } = state.openPosition
        if (side === 'long') {
          unrealized = (lastPrice - entryPrice) * amount
        } else if (side === 'short') {
          unrealized = (entryPrice - lastPrice) * amount
        }
      }
      unrealized = Number(unrealized)
      const wins = state.wins ?? 0
      const losses = state.losses ?? 0
      const trades = wins + losses
      const totalWinPnl = Number(state.totalWinPnl ?? 0)
      const totalLossPnl = Number(state.totalLossPnl ?? 0)
      const closedTrades = state.closedTrades ?? trades
      const totalTradeDurationMs = state.totalTradeDurationMs ?? 0
      const firstTradeAtMs = state.firstTradeAt ? Date.parse(state.firstTradeAt) : null
      const winRate = trades > 0 ? wins / trades : null
      const avgPnlPerTrade = trades > 0 ? (totalWinPnl + totalLossPnl) / trades : null
      const avgWin = wins > 0 ? totalWinPnl / wins : null
      const avgLoss = losses > 0 ? totalLossPnl / losses : null
      const avgTradeDurationMs = closedTrades > 0 ? totalTradeDurationMs / closedTrades : null
      let exposure = null
      if (firstTradeAtMs && now > firstTradeAtMs) {
        exposure = totalTradeDurationMs / (now - firstTradeAtMs)
      }
      const maxDrawdown = Number(state.maxDrawdown ?? 0)
      return {
        id,
        name: s?.name ?? id,
        description: s?.description ?? '',
        positionsOpened: state.positionsOpened ?? 0,
        wins,
        losses,
        trades,
        winRate,
        avgPnlPerTrade,
        avgWin,
        avgLoss,
        avgTradeDurationMs,
        exposure,
        maxDrawdown,
        running: runner.running.includes(id),
        realizedPnl: realized,
        unrealizedPnl: unrealized,
        totalPnl: realized + unrealized,
        position: state.openPosition ? { open: true, ...state.openPosition } : { open: false },
        lastDecision: lastDecisionByStrategy[id] ?? 'none'
      }
    })

    const firstState = loadState(runner.running[0] || STRATEGY_IDS[0])
    const { riskPerTrade, stopLossPct, takeProfitPct } = getEffectiveTradingConfig(firstState)
    const nextTickEtaMs =
      lastTickAt != null ? Math.max(0, pollIntervalMs - (now - Date.parse(lastTickAt))) : null

    const totalRealized = strategies.reduce((a, s) => a + (s.realizedPnl ?? 0), 0)
    const totalUnrealized = strategies.reduce((a, s) => a + (s.unrealizedPnl ?? 0), 0)
    const firstOpen = strategies.find(s => s.position.open)

    res.json({
      bot: {
        symbol,
        timeframe,
        mode: {
          testnet: config.binance.testnet,
          testingMode: config.trading.testingMode
        },
        lastTickAt,
        nextTickEtaMs,
        runningCount: runner.running.length
      },
      config: {
        autoTradingEnabled: firstState.autoTradingEnabled !== false,
        env: {
          riskPerTrade: config.trading.riskPerTrade,
          stopLossPct: config.trading.stopLossPct,
          takeProfitPct: config.trading.takeProfitPct
        },
        runtime: firstState.runtimeConfig || {},
        assetsToLog: config.trading.assetsToLog
      },
      strategies,
      portfolio: {
        balances: {
          BTC: {
            total: balance.total?.BTC ?? 0,
            free: balance.free?.BTC ?? 0,
            used: balance.used?.BTC ?? 0
          },
          USDT: {
            total: balance.total?.USDT ?? 0,
            free: balance.free?.USDT ?? 0,
            used: balance.used?.USDT ?? 0
          }
        }
      },
      position: firstOpen ? firstOpen.position : { open: false },
      orders: {
        openOrders: openOrders.map(o => ({
          id: o.id,
          side: o.side,
          amount: o.amount,
          price: o.price || null,
          status: o.status
        }))
      },
      market: {
        lastPrice,
        ema9,
        ema20,
        ema21,
        ema50,
        ema200,
        macd,
        macdSignal
      },
      pnl: {
        realized: Number(totalRealized),
        unrealized: Number(totalUnrealized),
        total: Number(totalRealized) + Number(totalUnrealized)
      }
    })
  } catch (err) {
    logger.error('Error in /api/status', err)
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// Manual buy endpoint (uses "manual" strategy)
app.post('/api/manual-buy', async (req, res) => {
  try {
    const strategyId = 'manual'
    let state = loadState(strategyId)
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]

    logger.info('Manual BUY requested via API')

    state = await openLongPosition(state, lastClose, strategyId)
    saveState(strategyId, state)

    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in /api/manual-buy', err)
    res.status(500).json({ error: 'Manual buy failed' })
  }
})

// Manual sell/close endpoint (uses "manual" strategy)
app.post('/api/manual-sell', async (req, res) => {
  try {
    const strategyId = 'manual'
    let state = loadState(strategyId)
    if (!state.openPosition) {
      return res.json({ status: 'ok', position: null })
    }

    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]

    logger.info('Manual SELL requested via API')

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

// Open a long position for a specific strategy
app.post('/api/strategies/:id/buy', async (req, res) => {
  try {
    const { id } = req.params
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
    state = await openLongPosition(state, lastClose, id)
    saveState(id, state)
    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in strategy buy', err)
    res.status(500).json({ error: 'Buy failed' })
  }
})

// Close position for a specific strategy
app.post('/api/strategies/:id/sell', async (req, res) => {
  try {
    const { id } = req.params
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
    if (!STRATEGY_IDS.includes(id)) {
      return res.status(400).json({ error: 'Unknown strategy' })
    }
    const state = loadState(id)
    state.realizedPnl = 0
    state.wins = 0
    state.losses = 0
    state.positionsOpened = 0
    state.totalWinPnl = 0
    state.totalLossPnl = 0
    state.closedTrades = 0
    state.totalTradeDurationMs = 0
    state.firstTradeAt = null
    state.peakEquity = 0
    state.maxDrawdown = 0
    saveState(id, state)
    logger.info(`PnL + win/loss counters + positionsOpened reset for strategy: ${id}`)
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
    for (const id of STRATEGY_IDS) {
      const state = loadState(id)
      state.realizedPnl = 0
      state.wins = 0
      state.losses = 0
      state.positionsOpened = 0
      state.totalWinPnl = 0
      state.totalLossPnl = 0
      state.closedTrades = 0
      state.totalTradeDurationMs = 0
      state.firstTradeAt = null
      state.peakEquity = 0
      state.maxDrawdown = 0
      saveState(id, state)
    }
    logger.info('PnL + win/loss counters + positionsOpened reset for all strategies')
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

// Recent trades with fee info (from Binance)
app.get('/api/trades', async (req, res) => {
  try {
    const exchange = getExchange()
    const limit = Math.min(Number(req.query.limit) || 50, 100)
    const trades = await exchange.fetchMyTrades(symbol, undefined, limit)
    const orderToStrategy = getOrderStrategyMap()

    const withFees = trades.map(t => {
      const orderId = t.order ?? t.orderId ?? null
      const raw = orderId ? orderToStrategy[String(orderId)] : null
      const strategyId = typeof raw === 'string' ? raw : (raw?.strategyId ?? null)
      const reason = typeof raw === 'object' && raw != null ? (raw.reason ?? null) : null
      const detail = typeof raw === 'object' && raw != null && raw.detail ? raw.detail : null
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
        detail: detail ?? null
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

// Candles + EMA data for charting
app.get('/api/candles', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500)
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

