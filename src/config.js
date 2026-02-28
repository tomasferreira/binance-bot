import dotenv from 'dotenv'

dotenv.config()

export const config = {
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    secret: process.env.BINANCE_API_SECRET || '',
    testnet: process.env.TESTNET !== 'false'
  },
  logging: {
    // LOG_LEVEL: DEBUG | INFO | WARN
    level: (process.env.LOG_LEVEL || 'INFO').toUpperCase(),
    // Max size of a single log file before rotation (in megabytes)
    maxSizeMB: Number(process.env.LOG_MAX_SIZE_MB || 10),
    // How many rotated log files to keep
    maxFiles: Number(process.env.LOG_MAX_FILES || 5)
  },
  trading: {
    symbol: process.env.SYMBOL || 'BTC/USDT',
    timeframe: process.env.TIMEFRAME || '15m',
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 60_000),
    riskPerTrade: Number(process.env.RISK_PER_TRADE || 0.01), // 1%
    stopLossPct: Number(process.env.STOP_LOSS_PCT || 0.02), // 2%
    takeProfitPct: Number(process.env.TAKE_PROFIT_PCT || 0.04), // 4%
    // Fee per side (decimal, e.g. 0.001 = 0.1%). Used for position sizing and SL/TP.
    feeRatePct: Number(process.env.FEE_RATE_PCT || 0.001),
    // Total quote (e.g. USDT) allocated to the bot. Split equally across strategies for position sizing.
    // If 0 or unset, each strategy uses full exchange balance (previous behavior).
    globalBudgetQuote: Number(process.env.GLOBAL_BUDGET_USDT || 0),
    testingMode: process.env.TESTING_MODE === 'true',
    assetsToLog: (process.env.ASSETS_TO_LOG || 'BTC,USDT')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    // Max closed trades kept per strategy for analysis; also used as max candles for chart API.
    closedTradesHistoryLimit: Math.max(100, Math.min(10000, Number(process.env.CLOSED_TRADES_HISTORY_LIMIT || 500) || 500)),
    // Regime (volatility + trend) is computed on a separate, higher timeframe for stability.
    regimeTimeframe: process.env.REGIME_TIMEFRAME || '1h',
    regimeCandles: Math.max(100, Math.min(1000, Number(process.env.REGIME_CANDLES || 200) || 200))
  },
  paths: {
    stateFile: new URL('../data/state.json', import.meta.url).pathname,
    dataDir: new URL('../data', import.meta.url).pathname,
    logDir: new URL('../logs', import.meta.url).pathname
  }
}

