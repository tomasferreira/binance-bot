# Binance Multi-Strategy Bot

A Node.js trading application that connects to Binance (testnet or live) via CCXT and runs multiple technical strategies on a configurable symbol and timeframe. It combines a headless engine that evaluates indicators and manages positions with a web dashboard for monitoring, control, and analysis.

## Overview

The app runs a set of **independent strategies** (EMA crossovers, MACD, RSI, Bollinger, ATR-based, range, Donchian, and others), each with its own state and optional open position. On a fixed interval it fetches OHLCV data, evaluates each enabled strategy on **closed candles only** (the current forming candle is excluded from signals to avoid repainting), and opens or closes positions according to signals and risk rules. **Current price** is still used for stop loss, take profit, and order execution. A built-in HTTP server serves a single-page dashboard with live status, portfolio, charts, trades (including PnL per closed trade), and performance analytics. State is persisted to disk so the process can be restarted without losing positions or strategy history.

## Configuration

- **Secrets and environment** — Stored in `.env`: `BINANCE_API_KEY`, `BINANCE_API_SECRET`, and `TESTNET`. Copy `.env.example` to `.env` and fill in your keys.
- **App settings** — Stored in `config.json` at the project root (symbol, timeframe, poll interval, risk, stop loss, take profit, fees, budget, regime, logging, etc.). Any key can be overridden by an environment variable. See **CONFIG.md** for a full reference of every setting and its env override.

## Trading Engine

- **Symbol and timeframe** — Configurable in `config.json` (e.g. BTC/USDT, 15m). The same symbol and timeframe are shared by all strategies.
- **Strategies** — Pluggable modules; each has a unique id, can be long or short, and exposes an `evaluate(ohlcv, state)` function. Entry and exit **signals** use only closed candles; **SL/TP and orders** use current price.
- **Regime filter** — Volatility and trend are computed on a separate, higher timeframe (e.g. 1h). When enabled, strategies only enter when the regime fits (e.g. long strategies in bullish trend). Can be toggled in the dashboard.
- **Execution** — Orders are placed and closed via CCXT. Position size is derived from risk-per-trade and optional global budget (split equally across strategies).
- **State** — Each strategy has its own state file under `data/` (open position, entry price, PnL history). Order-to-strategy mapping is stored so trade history and PnL are attributed correctly.
- **Auto trading** — A global toggle enables or disables automatic opening and closing; the dashboard and API still allow manual buy/sell and closing. You can also set it on startup via CLI flags (see below).

## Dashboard

The dashboard is a single HTML front end that talks to the backend REST API. It is organized into tabs:

- **Overview** — Top bar: symbol, timeframe, testnet/live mode, auto-trading toggle, **open positions / total strategies**, unrealized and total PnL, and actions (close all, reset stats). Below: portfolio balances, open positions summary, market regime (volatility, trend, direction, volume, price vs levels), and a price chart with candles and EMAs plus entry/exit markers per strategy.
- **Strategies** — Table of all strategies with name, running state, W/L, PnL, exposure, position, last decision, and actions (start/stop, long/short, close, reset PnL). Selecting a row shows a detail pane and focuses the chart on that strategy.
- **Trades & Activity** — Recent activity list and trades view: exchange trades with strategy attribution, reason, **PnL for closed positions**, amount, price, cost, fee.
- **Analysis** — Performance analytics with time-range filter (all time, 7d, 30d, since reset). Sortable table of metrics per strategy (PnL, W/L, win rate, Sharpe, max drawdown, fees, profit factor, expectancy, Sortino, etc.), top/bottom strategies, bar charts, and equity curve for a selected strategy.
- **Settings** — Budget, auto-trading, risk/SL/TP with apply and reset. Manual portfolio buy/sell (amount + unit).

## Risk and Configuration

- **Risk per trade** — Fraction of quote (or strategy budget) risked per position; used with stop distance for position sizing.
- **Stop loss / take profit** — Percentage from entry; applied when the engine closes the position.
- **Budget** — Optional global quote cap in `config.json`; split equally across strategies. If 0, each strategy can use full balance.
- **Testnet** — Set `TESTNET=true` in `.env` for Binance testnet; `false` for live.

## Data and Logging

- **State** — Under `data/`: one state file per strategy, runner state, and order-strategy map. Do not edit while the process is running.
- **Logging** — Winston; console and file (e.g. `logs/bot.log`). Level and file size in `config.json`.

## Technology

- **Runtime** — Node.js (ES modules).
- **Exchange** — CCXT for Binance (candles, account, orders, trades).
- **Server** — Express for the API and static dashboard.
- **Front end** — Single HTML file, Chart.js for candlestick and line charts.

The application is designed to run continuously, polling for new candles and updating positions and dashboard data on a fixed schedule while keeping full control and visibility through the web interface.

## Running the bot

Install dependencies:

```bash
npm install
```

Start the bot (default auto-trading state is whatever is stored in strategy state / last dashboard setting):

```bash
npm start
```

You can also force the global auto-trading flag on startup using CLI flags (same effect as the dashboard toggle applied to all strategies):

- **Force auto-trading OFF for all strategies:**

  ```bash
  npm start -- --auto-off
  # or
  npm start -- --no-auto
  ```

- **Force auto-trading ON for all strategies:**

  ```bash
  npm start -- --auto-on
  ```

These flags update `autoTradingEnabled` in each strategy’s state before the main loop starts.
