# config.json reference

All keys can be overridden by environment variables (e.g. `SYMBOL`, `TIMEFRAME`). Secrets (API keys, testnet) stay in `.env` only.

## http

| Key | Description |
|-----|-------------|
| `apiPort` | Port for the web dashboard and REST API (default: 3000). Env: `API_PORT`. |

## logging

| Key | Description |
|-----|-------------|
| `level` | Log level: `DEBUG`, `INFO`, or `WARN`. Env: `LOG_LEVEL`. |
| `maxSizeMB` | Max size of one log file before rotation (MB). Env: `LOG_MAX_SIZE_MB`. |
| `maxFiles` | Number of rotated log files to keep. Env: `LOG_MAX_FILES`. |

## trading

| Key | Description | Env |
|-----|-------------|-----|
| `symbol` | Trading pair (e.g. `BTC/USDT`). | `SYMBOL` |
| `timeframe` | Candle interval for all strategies (e.g. `1m`, `5m`, `15m`, `1h`). | `TIMEFRAME` |
| `pollIntervalMs` | How often the bot fetches candles and evaluates strategies (milliseconds). | `POLL_INTERVAL_MS` |
| `riskPerTrade` | Fraction of budget risked per trade (e.g. `0.01` = 1%). | `RISK_PER_TRADE` |
| `stopLossPct` | Stop loss distance from entry (e.g. `0.02` = 2%). | `STOP_LOSS_PCT` |
| `takeProfitPct` | Take profit distance from entry (e.g. `0.04` = 4%). | `TAKE_PROFIT_PCT` |
| `feeRatePct` | Fee per side (e.g. `0.001` = 0.1%); used for position sizing. | `FEE_RATE_PCT` |
| `globalBudgetQuote` | Total USDT allocated to the bot; split across strategies. `0` = use full balance. | `GLOBAL_BUDGET_USDT` |
| `testingMode` | If `true`, no real orders are placed. | `TESTING_MODE` |
| `assetsToLog` | Comma-separated assets to show in balance summary (e.g. `BTC,USDT`). | `ASSETS_TO_LOG` |
| `closedTradesHistoryLimit` | Max closed trades kept per strategy for analysis and chart (100–10000). | `CLOSED_TRADES_HISTORY_LIMIT` |
| `regimeTimeframe` | Higher timeframe for trend/volatility regime (e.g. `1h`). | `REGIME_TIMEFRAME` |
| `regimeCandles` | Number of bars used to compute regime (100–1000). | `REGIME_CANDLES` |
| `regimeFilterEnabled` | When `true`, strategies only enter when regime fits. Can be toggled in dashboard. | `REGIME_FILTER_ENABLED` |
| `closeOnlyExits` | When `true`, SL/TP and strategy exits are only evaluated on closed candles (close-only behavior). Default `false`. | `CLOSE_ONLY_EXITS` |
