import express from 'express'
import { config } from './config.js'
import { logger } from './logger.js'
import { getExchange } from './exchange.js'
import { loadState, saveState } from './state.js'
import { evaluateStrategy } from './strategy.js'
import { maybeClosePosition, openLongPosition, closePositionNow } from './tradeManager.js'
import { logPortfolio } from './portfolio.js'
import { logOpenOrders } from './orders.js'
import { getEMACrossSignal } from './indicators.js'

const { symbol, timeframe, pollIntervalMs } = config.trading
const apiPort = Number(process.env.API_PORT || 3000)

let lastTickAt = null
let lastDecision = 'none'

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

    const autoTradingEnabled = state.autoTradingEnabled !== false

    // First manage existing position (SL/TP)
    state = await maybeClosePosition(state, lastClose)

    // Evaluate new signals only if flat
    if (!state.openPosition) {
      if (autoTradingEnabled) {
        const decision = evaluateStrategy({ ohlcv, lastState: state })
        lastDecision = decision.action
        logger.info(`Decision: ${decision.action}`)
        if (decision.action === 'enter-long') {
          state = await openLongPosition(state, lastClose)
        }
      } else {
        lastDecision = 'auto-trading-disabled'
        logger.info('Decision: auto-trading-disabled (no strategy entries)')
      }
    } else {
      lastDecision = 'manage-open-position'
      logger.info('Decision: manage-open-position (no new entries while position is open)')
    }

    // Log portfolio, position, and orders each tick
    await logPortfolio(state)
    await logOpenOrders()

    saveState(state)
    lastTickAt = new Date().toISOString()
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
    const state = loadState()
    const exchange = getExchange()
    const balance = await exchange.fetchBalance()

    const ohlcv = await fetchMarketData(250)
    const closes = ohlcv.map(c => c[4])
    const last = ohlcv[ohlcv.length - 1]
    const lastPrice = last?.[4] ?? null
    const { fast: ema50, slow: ema200 } = getEMACrossSignal(ohlcv)

    const openOrders = await exchange.fetchOpenOrders(symbol)

    const { riskPerTrade, stopLossPct, takeProfitPct } = getEffectiveTradingConfig(state)

    const now = Date.now()
    const nextTickEtaMs =
      lastTickAt != null ? Math.max(0, pollIntervalMs - (now - Date.parse(lastTickAt))) : null

    res.json({
      bot: {
        symbol,
        timeframe,
        mode: {
          testnet: config.binance.testnet,
          testingMode: config.trading.testingMode
        },
        autoTradingEnabled: state.autoTradingEnabled !== false,
        lastTickAt,
        nextTickEtaMs,
        lastDecision
      },
      config: {
        env: {
          riskPerTrade: config.trading.riskPerTrade,
          stopLossPct: config.trading.stopLossPct,
          takeProfitPct: config.trading.takeProfitPct
        },
        runtime: state.runtimeConfig || {},
        assetsToLog: config.trading.assetsToLog
      },
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
      position: state.openPosition
        ? {
            open: true,
            ...state.openPosition
          }
        : { open: false },
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
        ema50,
        ema200
      }
    })
  } catch (err) {
    logger.error('Error in /api/status', err)
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// Manual buy endpoint
app.post('/api/manual-buy', async (req, res) => {
  try {
    let state = loadState()
    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]

    logger.info('Manual BUY requested via API')

    state = await openLongPosition(state, lastClose)
    saveState(state)

    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in /api/manual-buy', err)
    res.status(500).json({ error: 'Manual buy failed' })
  }
})

// Manual sell/close endpoint
app.post('/api/manual-sell', async (req, res) => {
  try {
    let state = loadState()
    if (!state.openPosition) {
      return res.json({ status: 'ok', position: null })
    }

    const ohlcv = await fetchMarketData(2)
    const lastClose = ohlcv[ohlcv.length - 1][4]

    logger.info('Manual SELL requested via API')

    state = await closePositionNow(state, lastClose)
    saveState(state)

    res.json({ status: 'ok', position: state.openPosition })
  } catch (err) {
    logger.error('Error in /api/manual-sell', err)
    res.status(500).json({ error: 'Manual sell failed' })
  }
})

// Runtime config update endpoint
app.post('/api/config', (req, res) => {
  try {
    const { autoTradingEnabled, riskPerTrade, stopLossPct, takeProfitPct } = req.body || {}

    let state = loadState()

    if (typeof autoTradingEnabled === 'boolean') {
      state.autoTradingEnabled = autoTradingEnabled
    }

    state.runtimeConfig = {
      ...(state.runtimeConfig || {}),
      ...(typeof riskPerTrade === 'number' ? { riskPerTrade } : {}),
      ...(typeof stopLossPct === 'number' ? { stopLossPct } : {}),
      ...(typeof takeProfitPct === 'number' ? { takeProfitPct } : {})
    }

    saveState(state)

    const effective = getEffectiveTradingConfig(state)

    logger.info(
      `Runtime config updated via API: autoTradingEnabled=${state.autoTradingEnabled}, ` +
        `riskPerTrade=${effective.riskPerTrade}, stopLossPct=${effective.stopLossPct}, ` +
        `takeProfitPct=${effective.takeProfitPct}`
    )

    res.json({
      status: 'ok',
      autoTradingEnabled: state.autoTradingEnabled,
      runtimeConfig: state.runtimeConfig
    })
  } catch (err) {
    logger.error('Error in /api/config', err)
    res.status(500).json({ error: 'Failed to update config' })
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

