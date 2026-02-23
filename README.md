## Binance EMA 50/200 Testnet Bot

Node.js Binance Testnet trading bot using CCXT with an EMA 50 / EMA 200 crossover strategy, 2% stop loss, 4% take profit, and 1% risk per trade.

### Features

- **Strategy**: EMA 50 / EMA 200 crossover (long-only)
- **Risk management**: 1% risk per trade based on quote balance
- **Stop loss**: 2% below entry
- **Take profit**: 4% above entry
- **Logging**: Console + `logs/bot.log` via `winston`
- **State persistence**: `data/state.json` so the bot can resume after restarts
- **Testnet support**: Uses Binance sandbox (`setSandboxMode(true)`) by default

### 1. Install dependencies

From the project root:

```bash
npm install
```

If you created the project manually:

```bash
npm install ccxt winston dotenv
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in your Binance **testnet** API keys:

```bash
cp .env.example .env
```

Edit `.env`:

- **BINANCE_API_KEY / BINANCE_API_SECRET**: your Binance testnet API credentials
- **TESTNET**: keep as `true` for testnet; set to `false` only for live trading
- **SYMBOL**: e.g. `BTC/USDT`
- **TIMEFRAME**: e.g. `15m`
- **POLL_INTERVAL_MS**: how often to poll for new candles
- **RISK_PER_TRADE**: fraction of quote balance to risk (e.g. `0.01` = 1%)
- **STOP_LOSS_PCT** / **TAKE_PROFIT_PCT**: 0.02 (2%) and 0.04 (4%) by default

### 3. Run the bot

```bash
npm start
# or
node src/index.js
```

On startup you should see:

- Exchange initialized in TESTNET mode
- Exchange status
- Periodic bot ticks and EMA status logs
- Trade open/close logs when the EMA crossover triggers.

### Develop on multiple computers

1. **Put the project under Git and push to a remote** (one-time, from your current machine):

   ```bash
   cd /path/to/crypt
   git init
   git add .
   git commit -m "Initial commit"
   # Create a repo on GitHub/GitLab/Bitbucket, then:
   git remote add origin https://github.com/YOUR_USER/crypt.git
   git push -u origin main
   ```

2. **On each other computer**, clone and set up:

   ```bash
   git clone https://github.com/YOUR_USER/crypt.git
   cd crypt
   npm install
   cp .env.example .env
   # Edit .env with your API keys (or copy from a secure backup)
   npm start
   ```

3. **Keep in sync**: pull before you start working, push when you leave:

   ```bash
   git pull
   # ... work ...
   git add .
   git commit -m "Describe changes"
   git push
   ```

- **Never commit `.env`** — it’s in `.gitignore`. Use the same keys on each machine or a password manager / secrets vault.
- **`data/` and `logs/`** are ignored so each machine has its own state and logs; if you want one shared “brain”, run the bot on a single server and only use other machines for code edits.

