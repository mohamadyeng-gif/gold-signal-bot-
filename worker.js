
const SYMBOLS = [
  { id: "xau", name: "طلا", digits: 2 },
  { id: "silver", name: "نقره", digits: 2 },
  { id: "bitcoin", name: "بیت‌کوین", digits: 2 },
  { id: "eurusd", name: "یورو/دلار", digits: 5 }
];

const API = "https://xaus.com/api/v1/chart";
const INTERVAL = 15 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/test") {
      if (!env.TEST_KEY || url.searchParams.get("key") !== env.TEST_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }

      await sendTelegram(env,
        "✅ پیام آزمایشی ربات دریافت شد.\nربات تلگرام آماده آزمایش است."
      );

      return new Response("Test message sent.");
    }

    return new Response(
      "Gold Signal Bot is running. Four markets are monitored every 15 minutes."
    );
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkMarkets(env));
  }
};

async function checkMarkets(env) {
  for (const market of SYMBOLS) {
    try {
      await checkMarket(env, market);
    } catch (error) {
      console.error("Market error:", market.id, error.message);
    }
  }
}

async function checkMarket(env, market) {
  const url = new URL(API);
  url.searchParams.set("symbol", market.id);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "15m");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error("Price API unavailable: " + response.status);
  }

  const json = await response.json();
  const points = json.points;

  if (!Array.isArray(points) || points.length < 40) {
    throw new Error("Insufficient candle data");
  }

  const now = Math.floor(Date.now() / 1000);

  // Use only fully closed 15-minute candles.
  const candles = points
    .map(p => ({
      t: Number(p.t),
      o: Number(p.o),
      h: Number(p.h),
      l: Number(p.l),
      c: Number(p.c),
      v: Number(p.v)
    }))
    .filter(p =>
      Number.isFinite(p.t) &&
      Number.isFinite(p.o) &&
      Number.isFinite(p.h) &&
      Number.isFinite(p.l) &&
      Number.isFinite(p.c) &&
      p.t + INTERVAL <= now
    )
    .sort((a, b) => a.t - b.t);

  if (candles.length < 30) {
    throw new Error("Not enough closed candles");
  }

  const closes = candles.map(x => x.c);
  const highs = candles.map(x => x.h);
  const lows = candles.map(x => x.l);

  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const rsiValues = rsi(closes, 14);
  const atrValues = atr(highs, lows, closes, 14);

  const i = closes.length - 1;
  const prev = i - 1;

  let side = null;

  if (
    fast[prev] <= slow[prev] &&
    fast[i] > slow[i] &&
    rsiValues[i] >= 50 &&
    rsiValues[i] < 70
  ) {
    side = "BUY";
  }

  if (
    fast[prev] >= slow[prev] &&
    fast[i] < slow[i] &&
    rsiValues[i] <= 50 &&
    rsiValues[i] > 30
  ) {
    side = "SELL";
  }

  if (!side || !Number.isFinite(atrValues[i]) || atrValues[i] <= 0) {
    return;
  }

  const candleTime = candles[i].t;
  const key = "signal_" + market.id;

  if (await env.SIGNAL_KV.get(key) === String(candleTime)) {
    return;
  }

  const entry = closes[i];
  const distance = atrValues[i] * 1.5;

  const stop = side === "BUY"
    ? entry - distance
    : entry + distance;

  const target = side === "BUY"
    ? entry + distance * 2
    : entry - distance * 2;

  const d = market.digits;

  const message =
    `🧪 سیگنال آزمایشی ${market.name}\n` +
    `نماد: ${market.id.toUpperCase()}\n` +
    `نوع: ${side}\n` +
    `تایم‌فریم: 15 دقیقه\n` +
    `ورود: ${entry.toFixed(d)}\n` +
    `حد ضرر: ${stop.toFixed(d)}\n` +
    `حد سود: ${target.toFixed(d)}\n` +
    `RSI: ${rsiValues[i].toFixed(1)}\n` +
    `زمان کندل: ${new Date(candleTime * 1000).toISOString()}\n` +
    `⚠️ فقط جهت آزمایش؛ سیگنال تضمین سود نیست.`;

  await sendTelegram(env, message);
  await env.SIGNAL_KV.put(key, String(candleTime));
}

async function sendTelegram(env, message) {
  if (!env.BOT_TOKEN || !env.CHAT_ID) {
    throw new Error("Telegram settings missing");
  }

  const response = await fetch(
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

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error("Telegram delivery failed");
  }
}

function ema(values, period) {
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);

  let value = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  out[period - 1] = value;

  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
    out[i] = value;
  }

  return out;
}

function rsi(values, period) {
  const out = Array(values.length).fill(null);
  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  out[period] = avgLoss === 0
    ? 100
    : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    avgGain = (avgGain * (period - 1) +
      Math.max(change, 0)) / period;

    avgLoss = (avgLoss * (period - 1) +
      Math.max(-change, 0)) / period;

    out[i] = avgLoss === 0
      ? 100
      : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return out;
}

function atr(high, low, close, period) {
  const tr = high.map((value, i) => {
    if (i === 0) return value - low[i];

    return Math.max(
      value - low[i],
      Math.abs(value - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
  });

  return ema(tr, period);
}
