
const API_URL =
  "https://xaus.com/api/v1/chart?symbol=xau&range=5d&interval=15m";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkGold(env));
  },

  async fetch(request, env) {
    return new Response(
      "Gold Signal Bot is running. Signals are checked every 15 minutes."
    );
  }
};

async function checkGold(env) {
  const response = await fetch(API_URL);
  if (!response.ok) throw new Error("Gold data unavailable");

  const json = await response.json();
  const candles = json.points || json.candles || [];

  if (candles.length < 30) {
    throw new Error("Not enough candle data");
  }

  const closes = candles.map(x => Number(x.c ?? x.close));
  const highs = candles.map(x => Number(x.h ?? x.high));
  const lows = candles.map(x => Number(x.l ?? x.low));
  const times = candles.map(x => Number(x.t ?? x.timestamp));

  if ([...closes, ...highs, ...lows].some(x => !Number.isFinite(x))) {
    throw new Error("Invalid candle data");
  }

  // Exclude the latest candle because it may still be forming.
  const end = closes.length - 1;
  const c = closes.slice(0, end);
  const h = highs.slice(0, end);
  const l = lows.slice(0, end);

  const fast = ema(c, 9);
  const slow = ema(c, 21);
  const rsiValue = rsi(c, 14);
  const atrValue = atr(h, l, c, 14);

  const i = c.length - 1;
  const previous = i - 1;

  let side = null;

  if (
    fast[previous] <= slow[previous] &&
    fast[i] > slow[i] &&
    rsiValue[i] >= 50 &&
    rsiValue[i] < 70
  ) side = "BUY";

  if (
    fast[previous] >= slow[previous] &&
    fast[i] < slow[i] &&
    rsiValue[i] <= 50 &&
    rsiValue[i] > 30
  ) side = "SELL";

  if (!side || !Number.isFinite(atrValue[i])) return;

  const candleTime = times[end - 1];
  const key = "last_signal";

  if (await env.SIGNAL_KV.get(key) === String(candleTime)) return;

  const entry = c[i];
  const distance = atrValue[i] * 1.5;
  const stop = side === "BUY" ? entry - distance : entry + distance;
  const take = side === "BUY" ? entry + distance * 2 : entry - distance * 2;

  const message =
    `🥇 XAU/USD — ${side}\n` +
    `⏱ تایم‌فریم: 15 دقیقه\n` +
    `ورود: ${entry.toFixed(2)}\n` +
    `حد ضرر: ${stop.toFixed(2)}\n` +
    `حد سود: ${take.toFixed(2)}\n` +
    `RSI: ${rsiValue[i].toFixed(1)}\n` +
    `⚠️ سیگنال آزمایشی؛ قبل از معامله بررسی شود.`;

  const tg = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.CHAT_ID,
        text: message
      })
    }
  );

  const result = await tg.json();
  if (!result.ok) throw new Error("Telegram send failed");

  await env.SIGNAL_KV.put(key, String(candleTime));
}

function ema(values, period) {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a,b) => a+b, 0) / period;
  out[period - 1] = value;

  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1-k);
    out[i] = value;
  }
  return out;
}

function rsi(values, period) {
  const out = Array(values.length).fill(null);
  let gain = 0, loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i-1];
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 :
    100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i-1];
    avgGain = (avgGain * (period-1) + Math.max(d,0)) / period;
    avgLoss = (avgLoss * (period-1) + Math.max(-d,0)) / period;
    out[i] = avgLoss === 0 ? 100 :
      100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atr(high, low, close, period) {
  const tr = high.map((v,i) => {
    if (i === 0) return v - low[i];
    return Math.max(
      v-low[i],
      Math.abs(v-close[i-1]),
      Math.abs(low[i]-close[i-1])
    );
  });

  return ema(tr, period);
}
