export const id = 'manual'
export const name = 'Manual'
export const description = 'No automatic entries. Use Buy/Sell on this card or in Risk & controls to trade.'

export function evaluate (ohlcv, state) {
  // Manual never auto-enters; only via dashboard Buy/Sell
  return { action: 'hold', detail: {} }
}
