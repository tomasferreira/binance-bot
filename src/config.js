import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../.env')

if (!fs.existsSync(envPath)) {
  throw new Error('Missing .env file at project root. Copy .env.example to .env and set BINANCE_API_KEY, BINANCE_API_SECRET, and TESTNET.')
}

dotenv.config({ path: envPath })

const configPath = path.resolve(__dirname, '../config.json')

let fileConfig = {}
if (fs.existsSync(configPath)) {
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (err) {
    throw new Error(`Invalid config.json: ${err.message}`)
  }
} else {
  throw new Error('config.json not found at project root.')
}

const env = process.env

function envOverride (key, type = 'string') {
  const v = env[key]
  if (v === undefined || v === '') return undefined
  if (type === 'number') return Number(v)
  if (type === 'boolean') return v === 'true'
  return String(v).trim()
}

const logging = {
  level: (envOverride('LOG_LEVEL') ?? fileConfig.logging?.level).toUpperCase(),
  maxSizeMB: Math.max(1, envOverride('LOG_MAX_SIZE_MB', 'number') ?? fileConfig.logging?.maxSizeMB),
  maxFiles: Math.max(1, envOverride('LOG_MAX_FILES', 'number') ?? fileConfig.logging?.maxFiles)
}

const tradingFromFile = fileConfig.trading ?? {}
const rawAssetsToLog = envOverride('ASSETS_TO_LOG') ?? tradingFromFile.assetsToLog
const rawClosedLimit = envOverride('CLOSED_TRADES_HISTORY_LIMIT', 'number') ?? tradingFromFile.closedTradesHistoryLimit
const rawRegimeCandles = envOverride('REGIME_CANDLES', 'number') ?? tradingFromFile.regimeCandles

const trading = {
  symbol: envOverride('SYMBOL') ?? tradingFromFile.symbol,
  timeframe: envOverride('TIMEFRAME') ?? tradingFromFile.timeframe,
  pollIntervalMs: envOverride('POLL_INTERVAL_MS', 'number') ?? tradingFromFile.pollIntervalMs,
  riskPerTrade: envOverride('RISK_PER_TRADE', 'number') ?? tradingFromFile.riskPerTrade,
  stopLossPct: envOverride('STOP_LOSS_PCT', 'number') ?? tradingFromFile.stopLossPct,
  takeProfitPct: envOverride('TAKE_PROFIT_PCT', 'number') ?? tradingFromFile.takeProfitPct,
  feeRatePct: envOverride('FEE_RATE_PCT', 'number') ?? tradingFromFile.feeRatePct,
  globalBudgetQuote: envOverride('GLOBAL_BUDGET_USDT', 'number') ?? tradingFromFile.globalBudgetQuote,
  testingMode: envOverride('TESTING_MODE', 'boolean') ?? tradingFromFile.testingMode,
  assetsToLog: typeof rawAssetsToLog === 'string'
    ? rawAssetsToLog.split(',').map(s => s.trim()).filter(Boolean)
    : Array.isArray(rawAssetsToLog) ? rawAssetsToLog : [],
  closedTradesHistoryLimit: Math.max(100, Math.min(10000, Number(rawClosedLimit))),
  regimeTimeframe: envOverride('REGIME_TIMEFRAME') ?? tradingFromFile.regimeTimeframe,
  regimeCandles: Math.max(100, Math.min(1000, Number(rawRegimeCandles))),
  regimeFilterEnabled: envOverride('REGIME_FILTER_ENABLED', 'boolean') ?? tradingFromFile.regimeFilterEnabled
}

const httpFromFile = fileConfig.http ?? {}
const http = {
  apiPort: Number(envOverride('API_PORT', 'number') ?? httpFromFile.apiPort)
}

export const config = {
  binance: {
    apiKey: env.BINANCE_API_KEY || '',
    secret: env.BINANCE_API_SECRET || '',
    testnet: env.TESTNET !== 'false'
  },
  logging,
  trading,
  http,
  paths: {
    stateFile: new URL('../data/state.json', import.meta.url).pathname,
    dataDir: new URL('../data', import.meta.url).pathname,
    logDir: new URL('../logs', import.meta.url).pathname
  }
}
