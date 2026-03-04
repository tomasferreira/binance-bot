let chart = null
let candleSeries = null
let volumeSeries = null
let ema50Series = null
let ema200Series = null

function ensureLib () {
  if (!window.LightweightCharts) return null
  return window.LightweightCharts
}

export function initFinancialChart () {
  const lib = ensureLib()
  const container = document.getElementById('financial-chart-container')
  if (!lib || !container) return
  if (chart) return

  const {
    createChart,
    CrosshairMode,
    CandlestickSeries,
    HistogramSeries,
    LineSeries
  } = lib

  const width = container.clientWidth || 600
  chart = createChart(container, {
    width,
    height: 320,
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

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444'
  })

  volumeSeries = chart.addSeries(HistogramSeries, {
    priceScaleId: '',
    priceFormat: { type: 'volume' },
    scaleMargins: { top: 0.8, bottom: 0 },
    color: '#1d4ed8'
  })

  ema50Series = chart.addSeries(LineSeries, {
    color: '#22c55e',
    lineWidth: 2
  })

  ema200Series = chart.addSeries(LineSeries, {
    color: '#f97316',
    lineWidth: 2
  })

  window.addEventListener('resize', () => {
    if (!chart) return
    const w = container.clientWidth || width
    chart.applyOptions({ width: w })
  })
}

export function updateFinancialChart (candles) {
  if (!chart || !Array.isArray(candles) || !candles.length) return

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

  const ema50Data = candles
    .filter(c => c.ema50 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema50
    }))
  ema50Series.setData(ema50Data)

  const ema200Data = candles
    .filter(c => c.ema200 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema200
    }))
  ema200Series.setData(ema200Data)
}

