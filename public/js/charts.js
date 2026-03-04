export async function fetchCandles () {
  const res = await fetch('/api/candles?limit=5000')
  if (!res.ok) throw new Error('Failed to fetch candles')
  return res.json()
}
