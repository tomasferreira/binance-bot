import { config } from './config.js'
import { getExchange } from './exchange.js'
import { STRATEGY_IDS, evaluateStrategy } from './strategies/registry.js'
import { getEffectiveTradingConfig } from './runtimeConfig.js'
import { calculatePositionSize } from './risk.js'
import { backtestLogger as logger } from './logger.js'
import { computeRegime } from './regime.js'

function timeframeToMs (tf) {
  const m = (tf || '').match(/^(\d+)(m|h|d)$/)
  if (!m) return 60 * 1000
  const n = parseInt(m[1], 10)
  if (m[2] === 'm') return n * 60 * 1000
  if (m[2] === 'h') return n * 60 * 60 * 1000
  if (m[2] === 'd') return n * 24 * 60 * 60 * 1000
  return 60 * 1000
}

// Lightweight in-memory state used for backtests only
function makeEmptyState (overrides = {}) {
  return {
    openPosition: null,
    realizedPnl: 0,
    wins: 0,
    losses: 0,
    positionsOpened: 0,
    totalWinPnl: 0,
    totalLossPnl: 0,
    closedTrades: 0,
    totalTradeDurationMs: 0,
    firstTradeAt: null,
    peakEquity: 0,
    maxDrawdown: 0,
    closedTradesHistory: [],
    runtimeConfig: {
      riskPerTrade: Number.isFinite(overrides.riskPerTrade) && overrides.riskPerTrade > 0 ? overrides.riskPerTrade : null,
      stopLossPct: Number.isFinite(overrides.stopLossPct) && overrides.stopLossPct > 0 ? overrides.stopLossPct : null,
      takeProfitPct: Number.isFinite(overrides.takeProfitPct) && overrides.takeProfitPct > 0 ? overrides.takeProfitPct : null
    },
    autoTradingEnabled: true
  }
}

async function fetchHistoricalCandles (symbol, timeframe, sinceMs, limit = 5000) {
  const exchange = getExchange()
  logger.info(`Backtest: fetching candles for ${symbol} ${timeframe} since ${new Date(sinceMs).toISOString()}`)
  // CCXT will page automatically when since is provided; we cap limit for safety
  const candles = await exchange.fetchOHLCV(symbol, timeframe, sinceMs, limit)
  logger.info(`Backtest: fetched ${candles.length} candles`)
  // Sanity check: ensure the exchange actually returned candles with the
  // expected timeframe (interval between timestamps).
  const expectedMs = timeframeToMs(timeframe)
  if (candles.length >= 2 && expectedMs > 0) {
    const deltas = []
    for (let i = 1; i < candles.length; i++) {
      deltas.push(candles[i][0] - candles[i - 1][0])
    }
    const deltaCounts = {}
    for (const d of deltas) {
      deltaCounts[d] = (deltaCounts[d] || 0) + 1
    }
    const dominantDelta = Number(
      Object.entries(deltaCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 0
    )
    if (dominantDelta !== expectedMs) {
      throw new Error(
        `Backtest: exchange returned candles with interval ${dominantDelta}ms, but configured timeframe ${timeframe} = ${expectedMs}ms`
      )
    }
  }
  return candles
}

function openSimPosition (state, side, price, candleTs, budgetQuote) {
  const { riskPerTrade, stopLossPct, takeProfitPct } = getEffectiveTradingConfig(state)
  if (!(riskPerTrade > 0) || !(stopLossPct > 0) || !(takeProfitPct > 0)) {
    return state
  }

  const feeRate = (config.trading.feeRatePct ?? 0)
  let stopLossPrice, takeProfitPrice
  if (side === 'long') {
    stopLossPrice = price * (1 - stopLossPct + feeRate) / (1 + feeRate)
    takeProfitPrice = price * (1 + takeProfitPct + 2 * feeRate)
  } else {
    stopLossPrice = price * (1 + stopLossPct)
    takeProfitPrice = price * (1 - takeProfitPct)
  }

  const balanceQuote = budgetQuote && budgetQuote > 0 ? budgetQuote : 10000 // simple default

  let amount = calculatePositionSize({
    balanceQuote,
    entryPrice: price,
    stopLossPrice,
    riskPerTrade,
    feeRatePct: feeRate
  })

  if (!(amount > 0)) return state

  const newPosition = {
    side,
    symbol: config.trading.symbol,
    entryPrice: price,
    amount,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    openedAt: candleTs
  }

  const positionsOpened = (state.positionsOpened ?? 0) + 1
  return { ...state, openPosition: newPosition, positionsOpened }
}

function closeSimPosition (state, price, candleTs) {
  const position = state.openPosition
  if (!position) return state
  const { side, entryPrice, amount } = position
  if (!(amount > 0)) return { ...state, openPosition: null }

  const pnl = side === 'short'
    ? (entryPrice - price) * amount
    : (price - entryPrice) * amount
  const realizedPnl = (state.realizedPnl ?? 0) + pnl

  let wins = state.wins ?? 0
  let losses = state.losses ?? 0
  let totalWinPnl = state.totalWinPnl ?? 0
  let totalLossPnl = state.totalLossPnl ?? 0
  if (pnl > 0) {
    wins++
    totalWinPnl += pnl
  } else if (pnl < 0) {
    losses++
    totalLossPnl += pnl
  }

  let closedTrades = state.closedTrades ?? 0
  let totalTradeDurationMs = state.totalTradeDurationMs ?? 0
  let firstTradeAt = state.firstTradeAt ?? (position.openedAt || null)
  const openedAtMs = typeof position.openedAt === 'number' ? position.openedAt : Date.parse(position.openedAt)
  const closedAtMs = candleTs
  if (openedAtMs != null && Number.isFinite(openedAtMs)) {
    const dur = Math.max(0, closedAtMs - openedAtMs)
    totalTradeDurationMs += dur
    closedTrades += 1
  }

  let peakEquity = state.peakEquity ?? 0
  let maxDrawdown = state.maxDrawdown ?? 0
  const equity = realizedPnl
  if (equity > peakEquity) {
    peakEquity = equity
  } else {
    const dd = equity - peakEquity
    if (dd < maxDrawdown) maxDrawdown = dd
  }

  const closedTradesHistory = Array.isArray(state.closedTradesHistory)
    ? [...state.closedTradesHistory, { timestamp: new Date().toISOString(), pnl }]
    : [{ timestamp: new Date().toISOString(), pnl }]

  return {
    ...state,
    openPosition: null,
    realizedPnl,
    wins,
    losses,
    totalWinPnl,
    totalLossPnl,
    closedTrades,
    totalTradeDurationMs,
    firstTradeAt,
    peakEquity,
    maxDrawdown,
    closedTradesHistory
  }
}

async function runBacktest () {
  const { symbol, timeframe, regimeTimeframe, regimeCandles } = config.trading
  const startedAtMs = Date.now()
  const argv = process.argv.slice(2)
  const daysBack = Number(argv.find(a => a.startsWith('--days='))?.split('=')[1] || 7)
  const riskOverride = Number(argv.find(a => a.startsWith('--risk='))?.split('=')[1] || NaN)
  const slOverride = Number(argv.find(a => a.startsWith('--sl='))?.split('=')[1] || NaN)
  const tpOverride = Number(argv.find(a => a.startsWith('--tp='))?.split('=')[1] || NaN)
  const regimeFlag = argv.find(a => a.startsWith('--regime='))
  const regimeFilterEnabled =
    regimeFlag != null
      ? regimeFlag.split('=')[1] !== 'false' && regimeFlag.split('=')[1] !== '0'
      : true
  const intrabarFlag = argv.find(a => a.startsWith('--intrabar='))
  const intrabarEnabled =
    intrabarFlag != null
      ? intrabarFlag.split('=')[1] !== 'false' && intrabarFlag.split('=')[1] !== '0'
      : true
  const sinceMs = Date.now() - daysBack * 24 * 60 * 60 * 1000

  const ohlcv = await fetchHistoricalCandles(symbol, timeframe, sinceMs)
  if (!ohlcv.length) {
    logger.warn('Backtest: no candles fetched; aborting')
    return
  }

  const states = {}
  for (const id of STRATEGY_IDS) {
    states[id] = makeEmptyState({
      riskPerTrade: riskOverride,
      stopLossPct: slOverride,
      takeProfitPct: tpOverride
    })
  }

  // Pre-fetch regime candles and compute initial regime (optional; best-effort).
  // Use the same parameters as live trading (regimeTimeframe, regimeCandles).
  let regime = null
  if (regimeFilterEnabled) {
    try {
      const regimeExchange = getExchange()
      const regimeTf = regimeTimeframe || '1h'
      const regimeLimit = Math.min(regimeCandles || 300, 1000)
      const regimeOhlcv = await regimeExchange.fetchOHLCV(symbol, regimeTf, undefined, regimeLimit)
      regime = computeRegime(regimeOhlcv) || null
    } catch (err) {
      logger.warn('Backtest: failed to compute initial regime', { err: err.message })
    }
  }

  const context = {
    regime,
    regimeFilterEnabled
  }

  // Replay candles one by one
  for (let i = 0; i < ohlcv.length; i++) {
    const slice = ohlcv.slice(0, i + 1)
    const [ts, , high, low, close] = slice[slice.length - 1]
    const lastClose = close

    for (const id of STRATEGY_IDS) {
      let state = states[id]
      const decision = evaluateStrategy(id, slice, state, context)
      const action = decision?.action || 'hold'

      if (state.openPosition) {
        const pos = state.openPosition
        const side = pos.side || 'long'
        if (intrabarEnabled) {
          // Simple intra-bar SL/TP check using high/low
          const hitSlLong = side === 'long' && low <= (pos.stopLoss ?? -Infinity)
          const hitTpLong = side === 'long' && high >= (pos.takeProfit ?? Infinity)
          const hitSlShort = side === 'short' && high >= (pos.stopLoss ?? Infinity)
          const hitTpShort = side === 'short' && low <= (pos.takeProfit ?? -Infinity)

          if (hitSlLong || hitTpLong || hitSlShort || hitTpShort) {
            // Close at SL/TP price (worst-case within bar)
            const exitPrice = hitSlLong
              ? pos.stopLoss
              : hitTpLong
                ? pos.takeProfit
                : hitSlShort
                  ? pos.stopLoss
                  : pos.takeProfit
            state = closeSimPosition(state, exitPrice, ts)
          } else {
            const wantsExitLong = side === 'long' && action === 'exit-long'
            const wantsExitShort = side === 'short' && action === 'exit-short'
            if (wantsExitLong || wantsExitShort) {
              state = closeSimPosition(state, lastClose, ts)
            }
          }
        } else {
          const wantsExitLong = side === 'long' && action === 'exit-long'
          const wantsExitShort = side === 'short' && action === 'exit-short'
          if (wantsExitLong || wantsExitShort) {
            state = closeSimPosition(state, lastClose, ts)
          }
        }
      } else {
        if (action === 'enter-long') {
          state = openSimPosition(state, 'long', lastClose, ts, null)
        } else if (action === 'enter-short') {
          state = openSimPosition(state, 'short', lastClose, ts, null)
        }
      }

      states[id] = state
    }
  }

  // Print summary (logger for logs; raw line for dashboard parser)
  logger.info('Backtest summary:')
  const summaryStrategies = []
  let totalPnl = 0
  for (const id of STRATEGY_IDS) {
    const s = states[id]
    totalPnl += s.realizedPnl || 0
    summaryStrategies.push({
      id,
      realizedPnl: s.realizedPnl ?? 0,
      trades: s.closedTrades ?? 0,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      maxDrawdown: s.maxDrawdown ?? 0
    })
    logger.info(
      `${id}: PnL=${s.realizedPnl.toFixed(2)} USDT, trades=${s.closedTrades}, wins=${s.wins}, losses=${s.losses}, maxDD=${s.maxDrawdown.toFixed(2)}`
    )
  }
  logger.info(`Backtest TOTAL PnL: ${totalPnl.toFixed(2)} USDT`)
  const meta = {
    timeframe,
    candles: ohlcv.length,
    startTs: ohlcv[0]?.[0] ?? null,
    endTs: ohlcv[ohlcv.length - 1]?.[0] ?? null,
    durationMs: Date.now() - startedAtMs
  }
  // Single line for API to parse (no logger prefix)
  process.stdout.write('BACKTEST_RESULT:' + JSON.stringify({ strategies: summaryStrategies, totalPnl, meta }) + '\n')
}

runBacktest().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Backtest failed', err)
  process.exit(1)
})

