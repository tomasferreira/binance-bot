let priceChart = null
let volumeChart = null
let candleSeries = null
let candleMarkers = null
let volumeSeries = null
let ma7Series = null
let ma25Series = null
let ma99Series = null
/** Last markers set (re-apply on zoom). */
let lastTradeMarkers = []

function ensureLib () {
  if (!window.LightweightCharts) return null
  return window.LightweightCharts
}

export function initFinancialChart () {
  const lib = ensureLib()
  const priceContainer = document.getElementById('financial-price-chart-container')
  const volumeContainer = document.getElementById('financial-volume-chart-container')
  if (!lib || !priceContainer || !volumeContainer) return
  if (priceChart && volumeChart) return

  const {
    createChart,
    CrosshairMode,
    createSeriesMarkers,
    CandlestickSeries,
    HistogramSeries,
    LineSeries
  } = lib

  const priceWidth = priceContainer.clientWidth || 600
  const volumeWidth = volumeContainer.clientWidth || priceWidth

  // Price chart (candles + MAs)
  priceChart = createChart(priceContainer, {
    width: priceWidth,
    height: 360,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#e5e7eb'
    },
    grid: {
      vertLines: { color: '#0f172a' },
      horzLines: { color: '#0f172a' }
    },
    rightPriceScale: {
      borderColor: '#1f2937'
    },
    timeScale: {
      borderColor: '#1f2937',
      timeVisible: true,
      secondsVisible: false
    },
    crosshair: {
      mode: CrosshairMode.Normal
    }
  })

  candleSeries = priceChart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444'
  })

  if (typeof createSeriesMarkers === 'function') {
    candleMarkers = createSeriesMarkers(candleSeries, [])
    const timeScale = priceChart.timeScale && priceChart.timeScale()
    if (timeScale && typeof timeScale.subscribeVisibleTimeRangeChange === 'function') {
      timeScale.subscribeVisibleTimeRangeChange(() => {
        const range = timeScale.getVisibleRange && timeScale.getVisibleRange()
        if (!range || !candleMarkers || !lastTradeMarkers.length) return
        const from = range.from
        const to = range.to
        const inRange = lastTradeMarkers.filter(m => {
          const t = m.time
          return t >= from && t <= to
        })
        candleMarkers.setMarkers(inRange)
      })
    }
  }

  ma7Series = priceChart.addSeries(LineSeries, {
    color: '#eab308', // MA(7) - yellow
    lineWidth: 2
  })

  ma25Series = priceChart.addSeries(LineSeries, {
    color: '#6366f1', // MA(25) - indigo
    lineWidth: 2
  })

  ma99Series = priceChart.addSeries(LineSeries, {
    color: '#f97316', // MA(99) - orange
    lineWidth: 2
  })

  // Volume chart (separate panel)
  volumeChart = createChart(volumeContainer, {
    width: volumeWidth,
    height: 140,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#9ca3af'
    },
    grid: {
      vertLines: { color: '#0f172a' },
      horzLines: { color: '#020617' }
    },
    rightPriceScale: {
      borderColor: '#1f2937'
    },
    timeScale: {
      borderColor: '#1f2937',
      timeVisible: false,
      secondsVisible: false
    },
    crosshair: {
      mode: CrosshairMode.Normal
    }
  })

  volumeSeries = volumeChart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    scaleMargins: { top: 0.05, bottom: 0.05 },
    color: '#1d4ed8'
  })

  // Keep charts responsive
  window.addEventListener('resize', () => {
    if (priceChart && priceContainer) {
      const w = priceContainer.clientWidth || priceWidth
      priceChart.applyOptions({ width: w })
    }
    if (volumeChart && volumeContainer) {
      const w2 = volumeContainer.clientWidth || volumeWidth
      volumeChart.applyOptions({ width: w2 })
    }
  })
}

export function updateFinancialChart (candles, trades = []) {
  if (!priceChart || !volumeChart || !Array.isArray(candles) || !candles.length) return

  const candleData = candles.map(c => ({
    time: Math.floor(c.timestamp / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }))
  candleSeries.setData(candleData)

  const volumeData = candles.map(c => {
    const up = c.close >= c.open
    return {
      time: Math.floor(c.timestamp / 1000),
      value: c.volume ?? 0,
      color: up ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'
    }
  })
  volumeSeries.setData(volumeData)

  const ma7Data = candles
    .filter(c => c.ema7 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema7
    }))
  ma7Series.setData(ma7Data)

  const ma25Data = candles
    .filter(c => c.ema25 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema25
    }))
  ma25Series.setData(ma25Data)

  const ma99Data = candles
    .filter(c => c.ema99 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema99
    }))
  ma99Series.setData(ma99Data)

  // Trade markers (v5 API)
  if (candleMarkers) {
    if (Array.isArray(trades) && trades.length > 0 && candles.length > 0) {
      const markers = []
      for (const t of trades) {
        const ts = typeof t.timestamp === 'number' ? t.timestamp : Number(t.timestamp)
        if (!Number.isFinite(ts)) continue
        let best = null
        let bestDiff = Infinity
        for (const c of candles) {
          const diff = Math.abs(ts - c.timestamp)
          if (diff < bestDiff) {
            bestDiff = diff
            best = c
          }
        }
        if (!best) continue
        const time = Math.floor(best.timestamp / 1000)
        const isBuy = t.side !== 'sell'
        const amount = Number(t.amount) || 0
        const price = Number(t.price) || null
        const strategy = t.strategyName || t.strategyId || ''
        const titleParts = [isBuy ? 'Buy' : 'Sell']
        if (amount) titleParts.push(String(amount))
        if (price) titleParts.push('@ ' + price)
        if (strategy) titleParts.push('(' + strategy + ')')
        markers.push({
          time,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color: isBuy ? '#22c55e' : '#ef4444',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: isBuy ? 'B' : 'S',
          title: titleParts.join(' ')
        })
      }
      lastTradeMarkers = markers
      candleMarkers.setMarkers(markers)
    } else {
      lastTradeMarkers = []
      candleMarkers.setMarkers([])
    }
  }
}

