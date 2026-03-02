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

- **EMA Crossover (50/200) – `ema_crossover`**: Uses two exponential moving averages `EMA_50` and `EMA_200`, with the usual update rule `EMA_n(t) = alpha * P_t + (1 - alpha) * EMA_n(t-1)` where `alpha = 2 / (n + 1)`. A long signal is generated when `EMA_50` crosses from below to above `EMA_200` (a “golden cross”) on a closed candle and no position is open. Example: previous candle `EMA_50 = 29,800 < EMA_200 = 30,000`, latest closed candle `EMA_50 = 30,050 > EMA_200 = 30,010` → issue `enter-long`.
- **EMA Fast Crossover – `ema_fast_crossover`**: Same logic as the 50/200 crossover but with shorter lookbacks (e.g. 9/21 or 12/26 EMAs), which makes `alpha` larger and the EMAs more reactive to recent price. This catches earlier trend shifts at the cost of more noise. Example: in a choppy market, price may cross the fast EMA above/below the slow EMA multiple times inside a tight range, leading to more frequent potential entries that are then filtered by the regime.
- **Multi-EMA (9/21/50) – `multi_ema`**: Requires a bullish EMA “stack” where `price > EMA_9 > EMA_21 > EMA_50`. It also checks the previous candle to detect when `EMA_9` crosses below `EMA_21` and uses that as an exit signal. Example: price = 31,000, `EMA_9 = 30,950`, `EMA_21 = 30,800`, `EMA_50 = 30,500` and no position → stack condition is true, so the strategy issues `enter-long`; later, if `EMA_9` falls below `EMA_21`, it issues `exit-long`.
- **Price vs EMA – `price_vs_ema`**: Compares the close `P_t` to a baseline EMA (for example `EMA_50`) using the relative distance `(P_t / EMA_50 - 1)`. When this distance stays above a small positive threshold for several candles, the strategy treats it as a persistent uptrend and may enter long; when price falls back below the EMA (ratio `< 0`), it avoids or exits. Example: if price trades 1–2 % above `EMA_50` for 10+ bars, the strategy is biased to be long or stay long.
- **RSI Pullback – `rsi_pullback`**: Uses standard RSI on closes with the usual definition `RSI = 100 - 100 / (1 + RS)` where `RS = avg_gain / avg_loss` over a lookback window. In an uptrend regime it looks for price above a trend filter (e.g. EMA) while RSI pulls back from overbought (>70) toward neutral (around 40–50) without going deeply oversold. Example: after an up-leg where RSI peaked at 75, a dip back to ~45 with price still above the EMA can trigger `enter-long` as a “buy the dip” signal.
- **MACD Line Crossover – `macd`**: Computes `MACD = EMA_fast - EMA_slow` and a signal line `Signal = EMA_9(MACD)`. When MACD crosses from below to above the signal line on a closed candle (and the regime is bullish), the strategy issues `enter-long`. Example: previous candle `MACD = -5`, `Signal = -3`, current candle `MACD = 1`, `Signal = -0.5` (zero-cross and line cross) → bullish momentum shift → long.
- **MACD Histogram Long – `macd_histogram_long`**: Focuses on the histogram `H = MACD - Signal`. A long setup appears when `H` stops decreasing while still negative and then starts increasing toward and above zero (a momentum inflection). Example: `H` sequence `-8, -5, -3, -1, +1` is interpreted as selling pressure exhausting then flipping to buying pressure; the first positive or strong uptick can trigger `enter-long`.
- **RSI + MACD Combo – `rsi_macd_combo`**: Requires both a bullish MACD condition (e.g. `MACD > Signal` and often `MACD >= 0`) and a “healthy” RSI band (e.g. 40–65) to enter long, reducing trades when momentum and mean-reversion signals disagree. Example: MACD crosses up but RSI is already >80 → signal is ignored; MACD crosses up with RSI around 50 and bullish regime → `enter-long`.
- **Bollinger Mean Revert – `bollinger_mean_revert`**: Uses Bollinger Bands on the close: middle band `m_t` is a moving average, upper/lower bands are `m_t ± k * sigma_t`, where `sigma_t` is the rolling standard deviation. In ranging or low-volatility regimes, if price closes near or below the lower band (e.g. `P_t < m_t - k * sigma_t`), the strategy treats this as an overshoot and looks to mean-revert back toward `m_t`. Example: `m_t = 30,000`, `sigma_t = 200`, `k = 2` → lower band = 29,600; close = 29,550 → possible `enter-long` with exits near the mid-band.
- **Bollinger Squeeze Breakout – `bollinger_squeeze`**: Measures band width `(upper - lower) / m_t` and compares it to a historical percentile; small widths indicate a “squeeze”. After a squeeze, a strong close beyond the upper band in a trending regime is treated as a volatility breakout and can trigger `enter-long`. Example: band width compresses to 1 % (10th percentile of history), then price closes above the upper band with expanding volume → strategy enters long for a volatility expansion move.
- **Donchian Breakout – `donchian_breakout`**: Tracks the highest high and lowest low over a rolling window `N`: `H_N = max(high_{t-N+1..t})`, `L_N = min(low_{t-N+1..t})`. A long breakout occurs when the close exceeds `H_N` by a small buffer, indicating a new N-bar high. Example: with `N = 20` and previous 20-bar high = 31,200, a close at 31,350 can generate `enter-long`; exits often use stops below mid-channel or a new low breakout in the opposite direction.
- **Stochastic Oversold – `stochastic_oversold`**: Uses %K and %D lines where `%K_t = 100 * (C_t - L_N) / (H_N - L_N)` over `N` bars and `%D` is a moving average of %K. In bullish or ranging regimes it looks for %K dipping below a level like 20 and then crossing back above %D while price holds above a trend filter. Example: if %K crosses up through %D at 18 and price is still above the 50 EMA, it may issue `enter-long` as an oversold bounce.
- **ATR Trend – `atr_trend`**: Computes Average True Range (ATR) over `N` bars where True Range is `max(high - low, |high - prev_close|, |low - prev_close|)`. It then derives an ATR-based band under price (for example `ATR_band = close - m * ATR`). When price closes above a rising ATR band in a bullish regime and no position is open, it enters long; closes back through the band can trigger an exit. Example: ATR = 150, multiplier `m = 2`, band = 30,000 − 300 = 29,700 and price closes at 30,200 → trend continuation long.
- **ATR Breakout – `atr_breakout`**: Uses ATR as a volatility filter for breakouts: requires that the move beyond a recent consolidation range is at least some multiple of ATR (e.g. `breakout_size >= 1.5 * ATR`). Example: recent range high = 30,000, ATR = 100; a close at 30,250 (2.5 ATR above the high) in a bullish regime can generate `enter-long`, while smaller one-ATR pokes are ignored.
- **Volume EMA Crossover – `volume_ema_crossover`**: Computes an EMA on volume `V_t` and compares current volume to `EMA_V`. It typically only accepts long EMA-price crossovers when `V_t > EMA_V * k` (for example `k = 1.2`), signalling above-average participation. Example: price EMA crossover triggers but volume is 0.8× typical → signal skipped; later, another crossover with volume 1.5× EMA passes the filter and issues `enter-long`.
- **Multi-TF Trend – `multi_tf_trend`**: Combines higher-timeframe (HTF) and local-timeframe (LTF) indicators. Conceptually, it requires HTF trend filters (e.g. upward-sloping `EMA_200` on HTF or HTF MACD > 0) to be bullish before acting on LTF triggers such as EMA crossovers. Example: 1h candles show price above HTF 200 EMA and MACD > 0, while on 15m a bullish crossover occurs → `enter-long`; if HTF flips bearish, new LTF entries are blocked.
- **Range Bounce – `range_bounce`**: Estimates a horizontal trading range using recent swing highs/lows or a percentile of the recent price distribution. In a ranging / low-vol regime, when price approaches the lower bound (e.g. within 5–10 % of range height) and shows stabilization, it enters long targeting the mid-range or upper bound. Example: range 29,500–30,500 (height = 1,000); a close near 29,550 with no breakdown and neutral regime may generate `enter-long`, with exits around 30,000–30,300.

### Short-biased strategies

- **Short Trend (EMA 50/200) – `short_trend`**: Symmetric to the long EMA trend logic; looks for a bearish stack where `price < EMA_50 < EMA_200`. While this configuration holds and the regime is bearish, it either enters or maintains a short. Exits occur when price closes back above `EMA_50` or when `EMA_50` is no longer below `EMA_200`. Example: price = 29,000, `EMA_50 = 29,200`, `EMA_200 = 29,500` → `enter-short`; later, price closing at 29,400 above `EMA_50` signals `exit-short`.
- **Short Breakdown – `short_breakdown`**: Uses support levels / recent lows similar to Donchian channels but inverted. If the close breaks below a recent multi-bar low `L_N` by more than a buffer and ATR confirms the move is large relative to noise, it issues `enter-short`. Example: 20-bar low = 28,500, ATR = 80; a close at 28,300 (2.5 ATR below that low) in a bearish regime is treated as a downside breakout and shorted.
- **Short Overbought – `short_overbought`**: Uses RSI in a bearish regime to fade sharp rallies. When RSI moves into overbought territory (e.g. >70) while trend filters remain bearish (price below EMA, MACD < 0), the strategy looks for RSI to roll over and then issues `enter-short`. Example: in a downtrend, RSI spikes to 78 on a short squeeze then drops back below 70 with price still under the 200 EMA → contrarian short entry.
- **Short MACD – `short_macd`**: Mirror of the long MACD strategy; when MACD crosses below its signal line and is often below zero, it signals building downside momentum. Example: previous candle `MACD = 3`, `Signal = 4`; current `MACD = 0`, `Signal = 2` (cross from above to below) in a bearish regime → `enter-short`.
- **Short MACD Histogram – `short_macd_histogram`**: Watches the MACD histogram rolling over from positive to negative or making lower highs while still positive. A sequence like `H = 6, 4, 2, -1` suggests buying pressure is fading and selling pressure is taking over; on the decisive downward break, the strategy can issue `enter-short`.
- **Short Rejection – `short_rejection`**: Looks for failed upside breakouts or wick rejections near resistance / upper bands (EMAs, Bollinger, Donchian highs). Typical pattern: price spikes above a reference level intrabar but closes back below it, creating a long upper wick and signaling rejection. Example: upper Bollinger band = 31,000; intrabar high = 31,200, close = 30,900 with a long upper wick in a bearish or neutral regime → `enter-short`.

### Manual strategy

- **Manual – `manual`**: Does not generate automatic entries or exits; its `evaluate` function always returns `hold`. You control entries and exits manually from the dashboard (buy/sell/close buttons), but the engine still applies the same position sizing, stop-loss/take-profit, PnL tracking, and analytics as for algorithmic strategies. Example use: discretionary trades around news events while still recording performance in the same framework.

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
