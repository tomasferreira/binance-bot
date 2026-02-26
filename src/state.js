import fs from 'fs'
import path from 'path'
import { config } from './config.js'
import { logger } from './logger.js'

const stateFilePath = config.paths.stateFile

const defaultState = {
  openPosition: null, // { side, symbol, entryPrice, amount, stopLoss, takeProfit, openedAt, lastPrice }
  lastSignal: null, // 'long' | 'short' | null
  realizedPnl: 0, // running total in quote (e.g. USDT) from closed positions
  // Runtime-tunable settings (override env config when present)
  autoTradingEnabled: true,
  runtimeConfig: {
    riskPerTrade: null,
    stopLossPct: null,
    takeProfitPct: null
  }
}

function ensureStateDir () {
  const dir = path.dirname(stateFilePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadState () {
  try {
    ensureStateDir()
    if (!fs.existsSync(stateFilePath)) {
      return { ...defaultState }
    }
    const raw = fs.readFileSync(stateFilePath, 'utf8')
    if (!raw) return { ...defaultState }
    const parsed = JSON.parse(raw)
    return { ...defaultState, ...parsed }
  } catch (err) {
    logger.error('Failed to load state', err)
    return { ...defaultState }
  }
}

export function saveState (state) {
  try {
    ensureStateDir()
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2))
  } catch (err) {
    logger.error('Failed to save state', err)
  }
}

