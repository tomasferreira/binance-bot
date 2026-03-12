import { statsFromHistory } from './stats.js'
import { computeUnrealizedPnl } from './runtimeConfig.js'

/**
 * Display name for strategy.
 * - Strips leading "Short " and trailing "(Long)/(Short)" from the raw name.
 * - Appends direction metadata as [long]/[short]/[both] when available.
 */
export function strategyDisplayName (name, id, direction = 'long') {
  if (!name) return id
  if (id === 'manual') return name
  let n = String(name)
    .replace(/^Short\s+/i, '')
    .replace(/\s+\((Long|Short)\)$/i, '')
  if (direction === 'both') return n + ' [both]'
  if (direction === 'short') return n + ' [short]'
  return n + ' [long]'
}

/**
 * Build the full JSON payload for GET /api/status.
 * @param {object} deps - Dependencies: runner, lastDecisionByStrategy, loadState, getStrategy, getStrategyDirection, getStrategyTimeframe, STRATEGY_IDS, isRegimeActive, config, getStrategyBudget, getEffectiveTradingConfig, lastTickAt, pollIntervalMs, symbol, balance, lastPrice, ema9, ema20, ema21, ema50, ema200, macd, macdSignal, regime, volatilityRatio, adxNow, plusDiNow, minusDiNow, regimeTf, regimeCandles, openOrders
 */
export function buildStatusPayload (deps) {
  const {
    runner,
    lastDecisionByStrategy,
    loadState,
    getStrategy,
    getStrategyDirection,
    getStrategyTimeframe,
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
    volumeLast = null,
    volumeAvg20 = null,
    recentHigh20 = null,
    recentLow20 = null
  } = deps

  const now = Date.now()
  const now7d = now - 7 * 24 * 60 * 60 * 1000
  const now30d = now - 30 * 24 * 60 * 60 * 1000

  const strategies = STRATEGY_IDS.map(id => {
    const state = loadState(id)
    const s = getStrategy(id)
    const realized = Number(state.realizedPnl ?? 0)
    const unrealized = Number(computeUnrealizedPnl(state.openPosition, lastPrice))
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
    const peakEquity = Number(state.peakEquity ?? 0)
    const currentEquity = realized + unrealized
    const currentDrawdown = Math.max(0, peakEquity - currentEquity)
    const currentDrawdownPct = peakEquity > 0 ? (currentDrawdown / peakEquity) * 100 : 0

    const history = Array.isArray(state.closedTradesHistory) ? state.closedTradesHistory : []
    const pnlResetAt = state.pnlResetAt || null
    const sinceResetEntries = pnlResetAt ? history.filter(e => new Date(e.timestamp).getTime() >= new Date(pnlResetAt).getTime()) : []
    const last7dEntries = history.filter(e => new Date(e.timestamp).getTime() >= now7d)
    const last30dEntries = history.filter(e => new Date(e.timestamp).getTime() >= now30d)
    const sinceReset = statsFromHistory(sinceResetEntries)
    const last7d = statsFromHistory(last7dEntries)
    const last30d = statsFromHistory(last30dEntries)

    const direction = getStrategyDirection(id)
    const primaryTf = config?.trading?.timeframe || '15m'
    return {
      id,
      name: strategyDisplayName(s?.name ?? id, id, direction),
      description: s?.description ?? '',
      timeframe: getStrategyTimeframe ? getStrategyTimeframe(id, primaryTf) : primaryTf,
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
      peakEquity,
      currentDrawdown,
      currentDrawdownPct,
      avgHoldTimeMin: closedTrades > 0 ? totalTradeDurationMs / closedTrades / 60000 : null,
      running: runner.running.includes(id),
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      totalPnl: realized + unrealized,
      direction,
      position: state.openPosition ? { open: true, ...state.openPosition } : { open: false },
      lastDecision: lastDecisionByStrategy[id] ?? 'none',
      pnlResetAt,
      closedTradesHistory: history,
      sinceReset,
      last7d,
      last30d,
      regimeActive: isRegimeActive(id, regime, runner.regimeFilterEnabled !== false)
    }
  })

  const firstState = loadState(runner.running[0] || STRATEGY_IDS[0])
  const regimeFilterEnabled = runner.regimeFilterEnabled !== false
  const nextTickEtaMs =
    lastTickAt != null ? Math.max(0, pollIntervalMs - (now - Date.parse(lastTickAt))) : null

  const totalRealized = strategies.reduce((a, s) => a + (s.realizedPnl ?? 0), 0)
  const totalUnrealized = strategies.reduce((a, s) => a + (s.unrealizedPnl ?? 0), 0)
  const firstOpen = strategies.find(s => s.position.open)

  let adverseSlipSum = 0; let adverseSlipCount = 0
  let favorableSlipSum = 0; let favorableSlipCount = 0
  let execSlipSum = 0; let execSlipCount = 0
  for (const s of strategies) {
    const allHist = Array.isArray(s.closedTradesHistory) ? s.closedTradesHistory : []
    const resetAt = s.pnlResetAt ? Date.parse(s.pnlResetAt) : null
    const hist = resetAt != null && Number.isFinite(resetAt)
      ? allHist.filter(e => {
          const t = e.timestamp ? Date.parse(e.timestamp) : null
          return t != null && Number.isFinite(t) && t >= resetAt
        })
      : allHist
    for (const e of hist) {
      const tp = typeof e.triggerPrice === 'number' ? e.triggerPrice : null
      const sa = typeof e.slippageAmount === 'number' ? e.slippageAmount : null
      if (tp && sa != null) {
        const ratio = Math.abs(sa / tp)
        if (e.runBy === true) { adverseSlipSum += ratio; adverseSlipCount++ }
        else if (e.favorableSlip === true) { favorableSlipSum += ratio; favorableSlipCount++ }
        else { adverseSlipSum += ratio; adverseSlipCount++ }
      }
      const execPct = typeof e.execSlippagePct === 'number' ? e.execSlippagePct : null
      if (execPct != null && Number.isFinite(execPct)) {
        execSlipSum += Math.abs(execPct)
        execSlipCount++
      }
    }
  }
  const avgSlippagePct = adverseSlipCount > 0 ? (adverseSlipSum / adverseSlipCount) * 100 : null
  const avgFavorableSlipPct = favorableSlipCount > 0 ? (favorableSlipSum / favorableSlipCount) * 100 : null
  const avgExecSlippagePct = execSlipCount > 0 ? (execSlipSum / execSlipCount) * 100 : null

  return {
    bot: {
      symbol,
      timeframe: config.trading.timeframe,
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
      regimeFilterEnabled,
      env: {
        riskPerTrade: config.trading.riskPerTrade,
        stopLossPct: config.trading.stopLossPct,
        takeProfitPct: config.trading.takeProfitPct
      },
      runtime: firstState.runtimeConfig || {},
      assetsToLog: config.trading.assetsToLog,
      budget: {
        globalBudgetQuote: config.trading.globalBudgetQuote || null,
        strategyBudgetQuote: getStrategyBudget(),
        strategyCount: STRATEGY_IDS.length
      },
      candlesLimit: config.trading.closedTradesHistoryLimit ?? 500
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
      macdSignal,
      volumeLast: volumeLast ?? null,
      volumeAvg20: volumeAvg20 ?? null,
      volumeRatio: (volumeAvg20 != null && volumeAvg20 > 0 && volumeLast != null) ? Math.round((volumeLast / volumeAvg20) * 100) / 100 : null,
      recentHigh20: recentHigh20 ?? null,
      recentLow20: recentLow20 ?? null,
      pctFromEma200: (lastPrice != null && ema200 != null && ema200 > 0) ? Math.round(((lastPrice - ema200) / ema200) * 10000) / 100 : null,
      pctFromRecentHigh: (lastPrice != null && recentHigh20 != null && recentHigh20 > 0) ? Math.round(((lastPrice - recentHigh20) / recentHigh20) * 10000) / 100 : null,
      pctFromRecentLow: (lastPrice != null && recentLow20 != null && recentLow20 > 0) ? Math.round(((lastPrice - recentLow20) / recentLow20) * 10000) / 100 : null,
      regime: {
        timeframe: regimeTf,
        candles: regimeCandles,
        volatility: regime.volatility,
        volatilityRatio: volatilityRatio != null ? Math.round(volatilityRatio * 100) / 100 : null,
        trend: regime.trend,
        adx: adxNow != null ? Math.round(adxNow * 10) / 10 : null,
        trendDirection: regime.trendDirection,
        plusDi: plusDiNow != null ? Math.round(plusDiNow * 10) / 10 : null,
        minusDi: minusDiNow != null ? Math.round(minusDiNow * 10) / 10 : null
      }
    },
    pnl: {
      realized: Number(totalRealized),
      unrealized: Number(totalUnrealized),
      total: Number(totalRealized) + Number(totalUnrealized),
      avgSlippagePct: avgSlippagePct != null ? avgSlippagePct : null,
      avgFavorableSlipPct: avgFavorableSlipPct != null ? avgFavorableSlipPct : null,
      avgExecSlippagePct: avgExecSlippagePct != null ? avgExecSlippagePct : null
    }
  }
}
