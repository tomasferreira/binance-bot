import fs from 'fs'
import path from 'path'
import { config } from './config.js'
import { logger } from './logger.js'

const dataDir = config.paths.dataDir

const defaultState = {
  openPosition: null,
  lastSignal: null,
  realizedPnl: 0,
  // Total number of positions this strategy has opened over time
  positionsOpened: 0,
  // Counts of closed winning/losing positions (realized PnL > 0 / < 0)
  wins: 0,
  losses: 0,
  // Aggregated PnL for wins/losses
  totalWinPnl: 0,
  totalLossPnl: 0,
  // Trade duration stats (for average duration & exposure)
  closedTrades: 0,
  totalTradeDurationMs: 0,
  firstTradeAt: null,
  // Max drawdown tracking based on realized equity
  peakEquity: 0,
  maxDrawdown: 0,
  autoTradingEnabled: true,
  pnlResetAt: null,
  closedTradesHistory: [],
  runtimeConfig: {
    riskPerTrade: null,
    stopLossPct: null,
    takeProfitPct: null
  }
}

function ensureDataDir () {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function statePath (strategyId) {
  return path.join(dataDir, `state_${strategyId}.json`)
}

const legacyStatePath = path.join(dataDir, 'state.json')

/** One-time migration: copy legacy state.json into state_<primaryId>.json so PnL and position persist. */
export function migrateLegacyState (primaryStrategyId) {
  try {
    if (!fs.existsSync(legacyStatePath)) return
    const raw = fs.readFileSync(legacyStatePath, 'utf8')
    if (!raw?.trim()) return
    const legacy = JSON.parse(raw)
    ensureDataDir()
    const targetPath = statePath(primaryStrategyId)
    let current = { ...defaultState }
    if (fs.existsSync(targetPath)) {
      const currentRaw = fs.readFileSync(targetPath, 'utf8')
      if (currentRaw?.trim()) current = { ...defaultState, ...JSON.parse(currentRaw) }
    }
    const merged = {
      ...current,
      realizedPnl: legacy.realizedPnl ?? current.realizedPnl,
      openPosition: legacy.openPosition ?? current.openPosition,
      lastSignal: legacy.lastSignal ?? current.lastSignal,
      autoTradingEnabled: legacy.autoTradingEnabled ?? current.autoTradingEnabled,
      runtimeConfig: { ...current.runtimeConfig, ...(legacy.runtimeConfig || {}) }
    }
    fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2))
    fs.renameSync(legacyStatePath, legacyStatePath + '.migrated')
    logger.info(`Migrated legacy state.json → state_${primaryStrategyId}.json (realizedPnl preserved)`)
  } catch (err) {
    logger.warn('Legacy state migration failed (non-fatal)', err)
  }
}

export function loadState (strategyId) {
  try {
    ensureDataDir()
    const fp = statePath(strategyId)
    if (!fs.existsSync(fp)) {
      return { ...defaultState }
    }
    const raw = fs.readFileSync(fp, 'utf8')
    if (!raw) return { ...defaultState }
    const parsed = JSON.parse(raw)
    return { ...defaultState, ...parsed }
  } catch (err) {
    logger.error(`Failed to load state for ${strategyId}`, err)
    return { ...defaultState }
  }
}

export function saveState (strategyId, state) {
  try {
    ensureDataDir()
    fs.writeFileSync(statePath(strategyId), JSON.stringify(state, null, 2))
  } catch (err) {
    logger.error(`Failed to save state for ${strategyId}`, err)
    throw err
  }
}
