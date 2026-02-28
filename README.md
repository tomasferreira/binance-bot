# Binance EMA Bot

A Node.js trading application that connects to Binance (testnet or live) via CCXT and runs multiple technical strategies on a configurable symbol and timeframe. It combines a headless engine that evaluates indicators and manages positions with a web dashboard for monitoring, control, and analysis.

## Overview

The app maintains a set of independent strategies, each with its own state and optional open position. On a fixed interval it fetches OHLCV data and EMAs from the exchange, evaluates each enabled strategy, and opens or closes positions according to signals and risk rules. A built-in HTTP server serves a single-page dashboard that shows live status, portfolio, charts, and performance analytics. State is persisted to disk so the process can be restarted without losing positions or strategy history.

## Trading Engine

- **Symbol and timeframe** — Configurable (e.g. BTC/USDT, 15m). The same symbol and timeframe are shared by all strategies.
- **Strategies** — Pluggable modules (EMA crossovers, MACD, RSI, Bollinger, multi-timeframe trend, ATR-based, and others). Each strategy has a unique id, can be long or short, and exposes an `evaluate(ohlcv, state)` function that returns actions such as buy, sell, or hold.
- **Execution** — Orders are placed and closed via CCXT. Position size is derived from a configurable risk-per-trade and optional per-strategy or global budget. Stop loss and take profit percentages can be set globally and applied to each position.
- **State** — Each strategy has its own state file under `data/` (e.g. open position, entry price, PnL history). The engine also keeps a mapping of order ids to strategies so trade history can be attributed correctly.
- **Auto trading** — A global toggle enables or disables automatic opening and closing of positions; the dashboard and API still allow manual buy/sell and closing.

## Dashboard

The dashboard is a single HTML front end that talks to the backend REST API. It is organized into tabs:

- **Overview** — Bot mode (testnet/live), symbol, timeframe, next tick ETA, auto-trading status, portfolio balances (e.g. BTC and USDT), aggregate realized/unrealized/total PnL, and a summary of open positions. A price chart shows candles and EMAs, with entry and exit markers for all strategies.
- **Strategies** — A table of all strategies (long and short) with name, type, running state, W/L, total PnL, exposure, current position, last decision, and actions: start/stop, long/short, close, reset PnL. Selecting a row shows a detail pane and focuses the chart on that strategy’s entries and exits.
- **Trades & Activity** — List of recent activity and a link to the trades view. Trade history is loaded from the API (exchange trades plus strategy attribution).
- **Analysis** — Performance analytics with a time-range filter (all time, last 7 days, last 30 days, or since last PnL reset). Includes a sortable table of metrics per strategy (total/realized/unrealized PnL, W/L, win rate, avg win/loss, Sharpe, max drawdown, trades, trades from history, fees, exposure, avg duration, profit factor, expectancy, max win, max loss, Sortino, trades per day, last trade). Top 3 and bottom 3 strategies by PnL, bar charts for total PnL and win rate, and an equity curve (cumulative PnL over time) for a selected strategy. Column headers have hover tooltips.
- **Settings** — Budget display, auto-trading toggle, risk per trade and stop loss / take profit inputs with apply and reset-to-env-defaults. Manual portfolio controls: amount and unit (e.g. BTC or USDT) for one-off buy/sell without using a specific strategy’s risk size.

## Risk and Configuration

- **Risk per trade** — Fraction of quote (or strategy budget) risked per position. Used with stop distance to compute position size.
- **Stop loss / take profit** — Percentage from entry; applied when the engine or exchange logic closes the position.
- **Budget** — Optional global or per-strategy quote budget caps; if unset, the bot can use full available balance within exchange limits.
- **Testnet** — The app can run against Binance testnet or live; mode is chosen via environment configuration.

## Data and Logging

- **State** — Stored under `data/`: one state file per strategy (positions, PnL reset timestamp, closed-trade history for analytics), plus runner and order-strategy mapping. Not intended to be edited by hand while the process is running.
- **Logging** — Winston is used for console and file logging (e.g. `logs/bot.log`). Log level and format are configurable.

## Technology

- **Runtime** — Node.js (ES modules).
- **Exchange** — CCXT for Binance connectivity (candles, account, orders, trades).
- **Server** — Express for the API and for serving the static dashboard.
- **Front end** — Single HTML file with inline CSS and JavaScript; Chart.js for candlestick, line, and bar charts.

The application is designed to run continuously, polling for new candles and updating positions and dashboard data on a fixed schedule while keeping full control and visibility through the web interface.
