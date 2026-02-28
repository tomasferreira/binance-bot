import { statsFromHistory } from './stats.js'
import { computeUnrealizedPnl } from './runtimeConfig.js'

/**
 * Display name for strategy (strips "Short"/"(Long)"/"(Short)" from name, appends [short]/[long]).
 */
export function strategyDisplayName (name, id) {
  if (!name) return id
  if (id === 'manual') return name
  let n = String(name)
    .replace(/^Short\s+/i, '')
    .replace(/\s+\((Long|Short)\)$/i, '')
  if (id && id.startsWith('short_')) return n + ' [short]'
  return n + ' [long]'
}

/**
 * Build the full JSON payload for GET /api/status.
 * @param {object} deps - Dependencies: runner, lastDecisionByStrategy, loadState, getStrategy, STRATEGY_IDS, isRegimeActive, config, getStrategyBudget, getEffectiveTradingConfig, lastTickAt, pollIntervalMs, symbol, balance, lastPrice, ema9, ema20, ema21, ema50, ema200, macd, macdSignal, regime, volatilityRatio, adxNow, plusDiNow, minusDiNow, regimeTf, regimeCandles, openOrders
 */
export function buildStatusPayload (deps) {
  const {
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
    openOrders
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

    const history = Array.isArray(state.closedTradesHistory) ? state.closedTradesHistory : []
    const pnlResetAt = state.pnlResetAt || null
    const sinceResetEntries = pnlResetAt ? history.filter(e => new Date(e.timestamp).getTime() >= new Date(pnlResetAt).getTime()) : []
    const last7dEntries = history.filter(e => new Date(e.timestamp).getTime() >= now7d)
    const last30dEntries = history.filter(e => new Date(e.timestamp).getTime() >= now30d)
    const sinceReset = statsFromHistory(sinceResetEntries)
    const last7d = statsFromHistory(last7dEntries)
    const last30d = statsFromHistory(last30dEntries)

    return {
      id,
      name: strategyDisplayName(s?.name ?? id, id),
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
      total: Number(totalRealized) + Number(totalUnrealized)
    }
  }
}
