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

## Built-in strategies

All strategies run on the same symbol and timeframe and respect the global regime filter, risk settings, and SL/TP. Each one is independent and can be enabled/disabled from the dashboard.

### Long-biased strategies

- **EMA Crossover (50/200) – `ema_crossover`**: Classic trend-following crossover; looks for the 50-period EMA crossing above the 200-period EMA to enter long in emerging uptrends.
- **EMA Fast Crossover – `ema_fast_crossover`**: Shorter-period EMA crossover that reacts faster than the 50/200 pair, aiming to capture earlier trend shifts at the cost of more noise.
- **Multi-EMA (9/21/50) – `multi_ema`**: Requires a bullish “stack” of EMAs (price > EMA9 > EMA21 > EMA50) to enter long and exits when the fast EMA (9) loses the medium EMA (21).
- **Price vs EMA – `price_vs_ema`**: Trend-following filter that goes long when price is persistently above a key EMA and stands aside when price falls back below it.
- **RSI Pullback – `rsi_pullback`**: Attempts to join uptrends on pullbacks, buying when RSI dips from overbought toward neutral while price remains in a broader bullish context.
- **MACD Line Crossover – `macd`**: Uses the MACD line crossing above its signal line to detect bullish momentum shifts and enter long.
- **MACD Histogram Long – `macd_histogram_long`**: Focuses on the MACD histogram moving from negative to positive (or strengthening positive) to capture momentum builds after pullbacks.
- **RSI + MACD Combo – `rsi_macd_combo`**: Combines RSI (for overbought/oversold and pullbacks) with MACD (for trend direction) to require confluence before entering long.
- **Bollinger Mean Revert – `bollinger_mean_revert`**: Mean-reversion strategy that buys when price washes out near/below the lower Bollinger Band in otherwise range-bound or low-vol regimes.
- **Bollinger Squeeze Breakout – `bollinger_squeeze`**: Watches for Bollinger Band “squeezes” (low volatility) and then enters on breakouts when volatility expands and trend resumes.
- **Donchian Breakout – `donchian_breakout`**: Trend-following breakout using Donchian channels; goes long when price breaks above a recent high channel after consolidation.
- **Stochastic Oversold – `stochastic_oversold`**: Uses the stochastic oscillator to buy oversold pullbacks in uptrends or ranges, aiming for bounces back toward the middle of the range.
- **ATR Trend – `atr_trend`**: Follows trends using ATR-based trailing levels; enters when price pushes away from the ATR band in the trend direction and manages exits as price revisits the band.
- **ATR Breakout – `atr_breakout`**: Looks for large ATR-sized moves beyond recent ranges, entering long on strong range expansions that signal the start or continuation of a trend.
- **Volume EMA Crossover – `volume_ema_crossover`**: Enhances EMA crossover logic by requiring volume to break above a volume EMA, favoring signals that occur with stronger participation.
- **Multi-TF Trend – `multi_tf_trend`**: Uses EMAs and/or MACD across multiple timeframes (e.g. higher TF trend + local TF trigger) to only enter long when both agree.
- **Range Bounce – `range_bounce`**: Pure mean-reversion in sideways markets; buys near defined range lows and aims to exit near the middle or upper portion of the range.

### Short-biased strategies

- **Short Trend (EMA 50/200) – `short_trend`**: Mirror of the EMA trend logic for downtrends; goes short when price < EMA50 < EMA200 (bearish stack) and exits when price reclaims EMA50 or the stack breaks.
- **Short Breakdown – `short_breakdown`**: Short trend-following breakout that sells when price breaks down below recent support or range lows and continues lower.
- **Short Overbought – `short_overbought`**: Mean-reversion / contrarian short; looks for overbought rallies (e.g. high RSI) in bearish regimes and enters short as momentum stalls.
- **Short MACD – `short_macd`**: Uses MACD crossing below its signal line (or staying negative) to detect downside momentum and initiate short positions.
- **Short MACD Histogram – `short_macd_histogram`**: Focuses on the MACD histogram rolling over from positive to negative or weakening positive to catch momentum shifts to the downside.
- **Short Rejection – `short_rejection`**: Shorts failed breakouts and wick rejections near resistance (often using EMAs/Bollinger levels), betting on price snapping back lower instead of continuing higher.

### Manual strategy

- **Manual – `manual`**: Does not generate automatic entries or exits. Exposes a strategy card in the dashboard so you can open/close positions manually while still using the same risk, PnL, and analytics pipeline.

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
