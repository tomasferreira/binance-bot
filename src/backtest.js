import { config } from './config.js'
import { getTradingExchange, getDataExchange } from './exchange.js'
import { getMarketDataSource, setMarketDataSource } from './marketDataSource.js'
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

function backtestMetricsFromHistory (state) {
  const history = Array.isArray(state.closedTradesHistory) ? state.closedTradesHistory : []
  if (!history.length) {
    return {
      winRate: null,
      avgWin: null,
      avgLoss: null,
      sharpe: null,
      profitFactor: null,
      expectancy: null,
      maxWin: null,
      maxLoss: null,
      sortino: null,
      tradesPerDay: null,
      timeInProfitPct: null,
      calmarRatio: null,
      recoveryFactor: null,
      maxDrawdownInRange: 0,
      currentDrawdownPct: null,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      lastTradeTs: null
    }
  }
  const pnls = history.map(e => Number(e.pnl ?? 0))
  const winsOnly = pnls.filter(p => p > 0)
  const lossesOnly = pnls.filter(p => p < 0)
  const sumWins = winsOnly.reduce((a, b) => a + b, 0)
  const sumLosses = lossesOnly.reduce((a, b) => a + b, 0)
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / Math.abs(sumLosses)
  const expectancy = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null
  const maxWin = winsOnly.length ? Math.max(...winsOnly) : null
  const maxLoss = lossesOnly.length ? Math.min(...lossesOnly) : null
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  const sharpe = std === 0 ? null : mean / std
  const negativeSquared = pnls.filter(p => p < 0).map(p => p * p)
  let sortino = null
  if (negativeSquared.length === 0) sortino = mean > 0 ? Infinity : (mean < 0 ? -Infinity : null)
  else {
    const downsideVariance = negativeSquared.reduce((a, b) => a + b, 0) / negativeSquared.length
    const downsideStd = Math.sqrt(downsideVariance)
    sortino = downsideStd === 0 ? null : mean / downsideStd
  }
  let peak = 0
  let maxDdInRange = 0
  let cum = 0
  for (const e of history) {
    cum += Number(e.pnl ?? 0)
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDdInRange) maxDdInRange = dd
  }
  const realizedPnl = pnls.reduce((a, b) => a + b, 0)
  const calmarRatio = maxDdInRange > 0 ? realizedPnl / maxDdInRange : null
  const recoveryFactor = maxDdInRange > 0 ? realizedPnl / maxDdInRange : null
  let cw = 0
  let cl = 0
  let maxW = 0
  let maxL = 0
  for (let i = pnls.length - 1; i >= 0; i--) {
    if (pnls[i] > 0) {
      cw++
      cl = 0
      if (cw > maxW) maxW = cw
    } else if (pnls[i] < 0) {
      cl++
      cw = 0
      if (cl > maxL) maxL = cl
    } else break
  }
  const lastEntry = history.reduce((a, b) => {
    const ta = new Date(a.timestamp).getTime()
    const tb = new Date(b.timestamp).getTime()
    return tb > ta ? b : a
  }, history[0])
  const lastTradeTs = new Date(lastEntry.timestamp).getTime()
  const firstTs = new Date(history[0].timestamp).getTime()
  const daysInRange = Math.max(1, (lastTradeTs - firstTs) / (86400 * 1000))
  const tradesPerDay = history.length && daysInRange > 0 ? history.length / daysInRange : null
  let atNewHigh = 0
  peak = 0
  cum = 0
  for (const e of history) {
    cum += Number(e.pnl ?? 0)
    if (cum >= peak) {
      atNewHigh++
      if (cum > peak) peak = cum
    }
  }
  const timeInProfitPct = (atNewHigh / history.length) * 100
  const currentDrawdownPct = peak > 0 ? ((peak - cum) / peak) * 100 : null
  const winsCount = state.wins ?? 0
  const lossesCount = state.losses ?? 0
  const winRate = winsCount + lossesCount > 0 ? winsCount / (winsCount + lossesCount) : null
  return {
    winRate,
    avgWin: winsOnly.length ? sumWins / winsOnly.length : null,
    avgLoss: lossesOnly.length ? sumLosses / lossesOnly.length : null,
    sharpe,
    profitFactor,
    expectancy,
    maxWin,
    maxLoss,
    sortino,
    tradesPerDay,
    timeInProfitPct,
    calmarRatio,
    recoveryFactor,
    maxDrawdownInRange: maxDdInRange,
    currentDrawdownPct,
    consecutiveWins: cw,
    consecutiveLosses: cl,
    maxConsecutiveWins: maxW,
    maxConsecutiveLosses: maxL,
    lastTradeTs
  }
}

/** Binance (and most exchanges) return at most 1000 candles per request; we paginate to get more. */
const EXCHANGE_KLINES_MAX = 1000

async function fetchHistoricalCandles (symbol, timeframe, sinceMs, limit = 5000) {
  const source = getMarketDataSource()
  const exchange = source === 'testnet' ? getTradingExchange() : getDataExchange()
  const periodMs = timeframeToMs(timeframe)
  logger.info(`Backtest: fetching candles for ${symbol} ${timeframe} since ${new Date(sinceMs).toISOString()} (limit ${limit})`)
  const candles = []
  let since = sinceMs
  while (candles.length < limit) {
    const chunk = await exchange.fetchOHLCV(symbol, timeframe, since, EXCHANGE_KLINES_MAX)
    if (!chunk.length) break
    for (const c of chunk) {
      if (candles.length >= limit) break
      candles.push(c)
    }
    if (chunk.length < EXCHANGE_KLINES_MAX) break
    since = chunk[chunk.length - 1][0] + periodMs
  }
  logger.info(`Backtest: fetched ${candles.length} candles`)
  // Sanity check: ensure the exchange actually returned candles with the expected timeframe.
  const expectedMs = periodMs
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
  const argv = process.argv.slice(2)
  const sourceArg = argv.find(a => a.startsWith('--source='))?.split('=')[1]
  if (sourceArg === 'live' || sourceArg === 'testnet') {
    setMarketDataSource(sourceArg)
  }
  logger.info(`Backtest: market data source ${getMarketDataSource()}`)

  const { symbol, timeframe, regimeTimeframe, regimeCandles } = config.trading
  const startedAtMs = Date.now()
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
  const periodMs = timeframeToMs(timeframe)
  const requestedCandles = Math.min(
    Math.ceil((daysBack * 24 * 60 * 60 * 1000) / periodMs),
    50000
  )

  const ohlcv = await fetchHistoricalCandles(symbol, timeframe, sinceMs, requestedCandles)
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

  // Regime: compute on the fly from last N bars before each candle so the same calendar time
  // always gets the same regime regardless of backtest length (22d vs 23d etc).
  const regimeComputeWindow = Math.max(30, regimeCandles ?? 200) // same as live
  let regimeOhlcv = []
  let regimePeriodMs = 0
  if (regimeFilterEnabled) {
    try {
      const regimeTf = regimeTimeframe || '1h'
      regimePeriodMs = timeframeToMs(regimeTf)
      const endMs = ohlcv.length ? ohlcv[ohlcv.length - 1][0] : sinceMs
      const sinceRegime = sinceMs - regimeComputeWindow * regimePeriodMs
      const regimeBarsNeeded =
        Math.ceil((endMs - sinceRegime) / regimePeriodMs) + 10
      const regimeLimit = Math.min(Math.max(regimeBarsNeeded, 100), 2000)
      regimeOhlcv = await fetchHistoricalCandles(symbol, regimeTf, sinceRegime, regimeLimit)
      logger.info(`Backtest: regime data ${regimeOhlcv.length} bars (${regimeComputeWindow} used per candle)`)
    } catch (err) {
      logger.warn('Backtest: failed to fetch regime data', { err: err.message })
    }
  }

  // Replay candles one by one
  for (let i = 0; i < ohlcv.length; i++) {
    const slice = ohlcv.slice(0, i + 1)
    const [ts, , high, low, close] = slice[slice.length - 1]
    const lastClose = close

    // Regime in effect at ts: use exactly the 300 bars ending at T = last regime bar before ts,
    // keyed by time so 22d vs 23d get the same window for the same ts.
    let regime = null
    if (regimeFilterEnabled && regimeOhlcv.length >= regimeComputeWindow) {
      const T = Math.floor((ts - 1) / regimePeriodMs) * regimePeriodMs // last regime bar open time before ts
      const windowStart = T - (regimeComputeWindow - 1) * regimePeriodMs
      let lo = 0
      let hi = regimeOhlcv.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (regimeOhlcv[mid][0] < windowStart) lo = mid + 1
        else hi = mid
      }
      const k = lo // first bar >= windowStart
      const lastBarTime = regimeOhlcv[k + regimeComputeWindow - 1]?.[0]
      if (k + regimeComputeWindow <= regimeOhlcv.length && lastBarTime != null && lastBarTime <= T) {
        const r = computeRegime(regimeOhlcv.slice(k, k + regimeComputeWindow))
        if (r) regime = r
      }
    }
    const context = {
      regime,
      regimeFilterEnabled
    }

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
      maxDrawdown: s.maxDrawdown ?? 0,
      ...backtestMetricsFromHistory(s)
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

