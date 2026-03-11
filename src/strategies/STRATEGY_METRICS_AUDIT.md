# Strategy bar-based metrics audit (by timeframe)

Each strategy runs on a fixed timeframe (see `STRATEGY_TIMEFRAMES` in `registry.js`). All periods/lookbacks below are in **bars of that TF**. Wall-clock meaning is noted where relevant.

---

## 1h strategies

| Strategy | Metrics | Wall clock (1h) | Suggestion |
|----------|---------|------------------|------------|
| **ema_crossover** | EMA 50, 200 (indicators) | ~2d, ~8d | No change. Classic. |
| **macd** | 12, 26, 9 | — | No change. Standard MACD. |
| **macd_histogram** | 12, 26, 9, EMA 200 | ~8d trend | No change. |
| **multi_tf_trend** | 20, 50, 100, 200 | ~20h–200h | No change. |
| **rsi_pullback** | RSI 14, EMA 50, 200 | — | No change. |
| **rsi_macd_combo** | RSI 14, MACD default | — | No change. |
| **bollinger_mean_revert** | BB 20, EMA 50, 200 | — | No change. |
| **bollinger_squeeze** | BB 20, WIDTH_LOOKBACK 50 | 50h | No change. |
| **atr_trend** | ATR 14, EMA 50/200 | — | No change. |
| **volume_ema_crossover** | VOLUME_PERIOD 24, EMA 50/200 | 24h = 1 day | **Done:** 20 → 24 (1-day volume baseline). |
| **short_trend** | 50, 200 | — | No change. |
| **short_breakdown** | 50, 200, LOOKBACK 14 | 14h recent support | **Done:** LOOKBACK 20 → 14 (~2 weeks). |
| **short_overbought** | RSI 14, 50, 200 | — | No change. |
| **short_macd** | 50, 200, MACD 12/26/9 | — | No change. |
| **short_rejection** | 50, 200, LOOKBACK 30 | 30h resistance | No change. |
| **range_bounce** | RANGE_LOOKBACK 50, BOUNCE_CANDLES 2 | ~2d range | No change. |

---

## 15m strategies

| Strategy | Metrics | Wall clock (15m) | Suggestion |
|----------|---------|-------------------|------------|
| **multi_ema** | 9, 21, 50 | ~2.25h, 5.25h, 12.5h | No change. |
| **price_vs_ema** | 20, 50, 200, PULLBACK 10 | 5h, 12.5h, 50h | **Done:** trend guard (EMA50 > EMA200) + pullback to EMA20 then close above; exit on price < EMA20 or < EMA50. |
| **donchian_breakout** | DONCHIAN 20, EMA 50 | 5h channel, 12.5h | No change. |
| **stochastic_oversold** | K 14, D 3 | — | No change. Standard. |
| **stop_hunt_reversal** | LOOKBACK 36 | ~9h range | **Done:** 50 → 36 (tighter “recent” range for failed breakout). |

---

## 5m strategies

| Strategy | Metrics | Wall clock (5m) | Suggestion |
|----------|---------|------------------|------------|
| **atr_breakout** | LOOKBACK 24, ATR 14, ATR_RISE 5 | 2h high, 25min rise | **Done:** LOOKBACK 20 → 24 (2h). |
| **ema_fast_crossover** | 9, 21 | 45min, 1.75h | No change. Good for scalping. |
| **impulse_follow** | LOOKBACK 20 | ~1.7h | No change. |
| **impulse_pullback** | LOOKBACK 20, MAX_PULLBACK_BARS 3 | — | No change. |
| **vwap_revert** | 24h bars (timeframe-aware) | 1 day | No change. Uses `context.timeframe`. |
| **volume_climax_reversal** | VOL 24, MOVE 8, MIN_MOVE_BARS 3, MIN_MOVE_PCT 0.5% | 2h vol, 40min move | **Done:** VOL 24; exhaustion = ≥3 bars + ≥0.5% move before climax. |

---

## Summary of changes applied

1. **volume_ema_crossover (1h):** VOLUME_PERIOD 20 → 24 (1-day volume baseline).
2. **short_breakdown (1h):** LOOKBACK 20 → 14 (recent support ~2 weeks).
3. **stop_hunt_reversal (15m):** LOOKBACK 50 → 36 (~9h “recent” range).
4. **atr_breakout (5m):** LOOKBACK 20 → 24 (2h N-period high).
5. **volume_climax_reversal (5m):** VOL_LOOKBACK 20 → 24 (2h volume average).

All other strategies kept existing bar counts; they already match common usage for their timeframe.
