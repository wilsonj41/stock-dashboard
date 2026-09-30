// Deploy as "dashboard". No extra packages required; secrets stay on the server.
const env = (key: string) => Deno.env.get(key) ?? "";
const encoder = new TextEncoder();

class ClientError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Quote = { symbol: string; name: string; price: number; previous_close: number; open: number | null; high: number | null; low: number | null; market_at: string; fetched_at: string };
type Brand = { name: string | null; logo_url: string | null };
type LogoRow = Brand & { provider?: string };
type DetailKind = "profile" | "news" | "recommendations";
type Profile = { market_cap: number | null; industry: string | null; exchange: string | null; website: string | null; shares_outstanding: number | null; ipo: string | null };
type NewsItem = { id: number; headline: string; summary: string | null; source: string | null; url: string; published_at: string };
type Recommendation = { period: string; strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number };
type DetailRow = { payload: unknown; fetched_at: string };

const backendSecret = () => env("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}").default;

async function db(path: string, method = "GET", body?: unknown) {
  const secret = backendSecret();
  if (!secret) throw new Error("Missing backend credentials");
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/${path}`, {
    method,
    headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Database unavailable");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function claim(kind: string, key: string, force = false): Promise<boolean> {
  return await db("rpc/dashboard_claim", "POST", { p_kind: kind, p_key: key, p_force: force });
}
async function digest(value: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function equal(a: string, b: string) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return x.reduce((diff, byte, i) => diff | (byte ^ y[i]), 0) === 0;
}
async function sessionKey() {
  if (env("ADMIN_PASSWORD").length < 6) throw new Error("Set an admin password of at least 6 characters");
  return crypto.subtle.importKey("raw", await digest(`dashboard-session:${env("ADMIN_PASSWORD")}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (n) => n.toString(16).padStart(2, "0")).join("");
async function token() {
  const payload = crypto.randomUUID();
  return `${payload}.${hex(await crypto.subtle.sign("HMAC", await sessionKey(), encoder.encode(payload)))}`;
}
async function authorize(request: Request) {
  const value = request.headers.get("x-admin-token") || "";
  if (!/^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(value)) throw new ClientError("Unlock editing with the admin password.", 401);
  const [payload, signature] = value.split(".");
  const bytes = Uint8Array.from(signature.match(/../g)!, (s) => parseInt(s, 16));
  if (!(await crypto.subtle.verify("HMAC", await sessionKey(), bytes, encoder.encode(payload)))) throw new ClientError("Your admin unlock is no longer valid. Please unlock again.", 401);
}
function symbolOf(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(value)) throw new ClientError("Enter a valid US ticker, such as AAPL.");
  return value;
}
async function savedQuote(symbol: string): Promise<Quote | null> {
  return (await db(`dashboard_quotes?symbol=eq.${encodeURIComponent(symbol)}`))[0] ?? null;
}
async function savedDetail<T>(symbol: string, kind: DetailKind): Promise<{ data: T; fetched_at: string } | null> {
  const row = (await db(`dashboard_detail_cache?symbol=eq.${encodeURIComponent(symbol)}&kind=eq.${kind}`))[0] as DetailRow | undefined;
  return row ? { data: row.payload as T, fetched_at: row.fetched_at } : null;
}
async function cacheDetail<T>(symbol: string, kind: DetailKind, data: T) {
  await db("dashboard_detail_cache?on_conflict=symbol,kind", "POST", { symbol, kind, payload: data, fetched_at: new Date().toISOString() });
}
async function cachedDetail<T>(symbol: string, kind: DetailKind, maxAge: number, load: () => Promise<T>) {
  const cached = await savedDetail<T>(symbol, kind);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < maxAge) return { data: cached.data, warning: null };
  if (!(await claim(kind, symbol))) return { data: cached?.data ?? null, warning: cached ? "Showing the latest saved data." : "This information is temporarily unavailable." };
  try {
    const data = await load();
    await cacheDetail(symbol, kind, data);
    return { data, warning: null };
  } catch {
    return { data: cached?.data ?? null, warning: cached ? "Fresh data is unavailable. Showing the latest saved data." : "This information is temporarily unavailable." };
  }
}
async function finnhub(path: string, params: Record<string, string>) {
  const key = env("FINNHUB_API_KEY");
  if (!key) throw new Error("Missing market-data key");
  const url = new URL(`https://finnhub.io/api/v1${path}`);
  url.search = new URLSearchParams({ ...params, token: key }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) throw new Error("Provider unavailable");
  return data;
}

const asFiniteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const asText = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
function profileFrom(data: Record<string, unknown>, symbol: string): Profile {
  if (data.ticker !== symbol || data.country !== "US") throw new Error("Unsupported company profile");
  return {
    market_cap: asFiniteNumber(data.marketCapitalization),
    industry: asText(data.finnhubIndustry),
    exchange: asText(data.exchange),
    website: asText(data.weburl),
    shares_outstanding: asFiniteNumber(data.shareOutstanding),
    ipo: asText(data.ipo),
  };
}
async function profile(symbol: string) {
  return cachedDetail<Profile>(symbol, "profile", 24 * 60 * 60 * 1000, async () => {
    const data = await finnhub("/stock/profile2", { symbol }) as Record<string, unknown>;
    return profileFrom(data, symbol);
  });
}
async function news(symbol: string) {
  return cachedDetail<NewsItem[]>(symbol, "news", 15 * 60 * 1000, async () => {
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const data = await finnhub("/company-news", { symbol, from, to: today.toISOString().slice(0, 10) });
    if (!Array.isArray(data)) throw new Error("Invalid news response");
    return data
      .map((item): NewsItem | null => {
        if (!item || typeof item !== "object") return null;
        const value = item as Record<string, unknown>;
        const id = asFiniteNumber(value.id);
        const headline = asText(value.headline);
        const url = asText(value.url);
        const timestamp = asFiniteNumber(value.datetime);
        if (id === null || !headline || !url || timestamp === null) return null;
        return { id, headline, summary: asText(value.summary), source: asText(value.source), url, published_at: new Date(timestamp * 1000).toISOString() };
      })
      .filter((item): item is NewsItem => item !== null)
      .slice(0, 6);
  });
}
async function recommendations(symbol: string) {
  return cachedDetail<Recommendation | null>(symbol, "recommendations", 6 * 60 * 60 * 1000, async () => {
    const data = await finnhub("/stock/recommendation", { symbol });
    if (!Array.isArray(data) || !data.length || !data[0] || typeof data[0] !== "object") return null;
    const value = data[0] as Record<string, unknown>;
    const period = asText(value.period);
    if (!period) return null;
    return {
      period,
      strong_buy: asFiniteNumber(value.strongBuy) ?? 0,
      buy: asFiniteNumber(value.buy) ?? 0,
      hold: asFiniteNumber(value.hold) ?? 0,
      sell: asFiniteNumber(value.sell) ?? 0,
      strong_sell: asFiniteNumber(value.strongSell) ?? 0,
    };
  });
}

const storageLogoUrl = (symbol: string) => `${env("SUPABASE_URL")}/storage/v1/object/public/dashboard-logos/${encodeURIComponent(symbol)}`;
async function downloadAndStoreLogo(symbol: string, source: string | null) {
  if (!source) return null;
  try {
    const sourceUrl = new URL(source);
    if (sourceUrl.protocol !== "https:" || !["static.finnhub.io", "static2.finnhub.io"].includes(sourceUrl.hostname)) return null;
    const image = await fetch(sourceUrl, { signal: AbortSignal.timeout(10000) });
    const contentType = image.headers.get("content-type") || "";
    const secret = backendSecret();
    if (!image.ok || !contentType.startsWith("image/") || !secret) return null;
    const uploaded = await fetch(`${env("SUPABASE_URL")}/storage/v1/object/dashboard-logos/${encodeURIComponent(symbol)}`, {
      method: "POST",
      headers: { apikey: secret, Authorization: `Bearer ${secret}`, "Content-Type": contentType, "x-upsert": "true", "cache-control": "31536000" },
      body: await image.arrayBuffer(), signal: AbortSignal.timeout(10000),
    });
    return uploaded.ok ? storageLogoUrl(symbol) : null;
  } catch { return null; }
}
async function fetchBrand(symbol: string): Promise<Brand | null> {
  const data = await finnhub("/stock/profile2", { symbol }) as Record<string, unknown>;
  const company = profileFrom(data, symbol);
  const name = asText(data.name);
  if (!name) return null;
  await cacheDetail(symbol, "profile", company);
  return { name, logo_url: await downloadAndStoreLogo(symbol, typeof data.logo === "string" ? data.logo : null) };
}
async function cachedBrand(symbol: string): Promise<Brand | null> {
  const cached = (await db(`dashboard_logos?symbol=eq.${encodeURIComponent(symbol)}`))[0] as LogoRow | undefined;
  if (cached?.provider === "finnhub" && cached.name) return { name: cached.name, logo_url: cached.logo_url };
  if (!(await claim("profile", symbol))) return null;
  try {
    const brand = await fetchBrand(symbol);
    const row = { symbol, name: brand?.name ?? null, logo_url: brand?.logo_url ?? null, provider: "finnhub", checked_at: new Date().toISOString() };
    if (cached) await db(`dashboard_logos?symbol=eq.${encodeURIComponent(symbol)}`, "PATCH", row);
    else await db("dashboard_logos?on_conflict=symbol", "POST", row);
    return brand;
  } catch { return null; }
}
async function quote(symbol: string, force: boolean, name?: string) {
  const cached = await savedQuote(symbol);
  if (!force && cached && Date.now() - Date.parse(cached.fetched_at) < 60000) return { quote: cached, warning: null };
  if (!env("FINNHUB_API_KEY")) return { quote: cached, warning: "Fresh price data is temporarily unavailable. Showing saved data when available." };
  if (!(await claim("quote", symbol, force))) {
    const latest = await savedQuote(symbol);
    return { quote: latest, warning: latest && !force && Date.now() - Date.parse(latest.fetched_at) < 60000 ? null : "This price could not be refreshed right now. Showing saved data when available; please try again shortly." };
  }
  try {
    const data = await finnhub("/quote", { symbol });
    const price = Number(data.c), previousClose = Number(data.pc), timestamp = Number(data.t);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(previousClose) || previousClose <= 0 || !Number.isFinite(timestamp) || timestamp <= 0) throw new Error("Unsupported or incomplete quote");
    const result: Quote = {
      symbol,
      name: name || cached?.name || symbol,
      price,
      previous_close: previousClose,
      open: asFiniteNumber(data.o),
      high: asFiniteNumber(data.h),
      low: asFiniteNumber(data.l),
      market_at: new Date(timestamp * 1000).toISOString(),
      fetched_at: new Date().toISOString(),
    };
    await db("dashboard_quotes?on_conflict=symbol", "POST", result);
    return { quote: result, warning: null };
  } catch {
    return { quote: cached, warning: cached ? "Fresh price data is unavailable. Showing the last saved quote." : "No price is available for this stock right now. Check the ticker and try again later." };
  }
}
async function backfillBrands(stocks: { symbol: string; name: string }[]) {
  const logos = (await db("dashboard_logos")) as (LogoRow & { symbol: string })[];
  const bySymbol = new Map(logos.map((logo) => [logo.symbol, logo]));
  const missing = stocks.filter((stock) => bySymbol.get(stock.symbol)?.provider !== "finnhub");
  for (let index = 0; index < missing.length; index += 5) {
    const batch = await Promise.all(missing.slice(index, index + 5).map(async (stock) => ({ symbol: stock.symbol, ...(await cachedBrand(stock.symbol)) })));
    for (const brand of batch) bySymbol.set(brand.symbol, brand);
  }
  return bySymbol;
}

Deno.serve(async (request: Request) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-admin-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers });
  if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new ClientError("Request is too large.", 413);
    let input;
    try { input = JSON.parse(raw); } catch { throw new ClientError("Invalid request."); }
    if (!input || typeof input !== "object") throw new ClientError("Invalid request.");
    switch (input.action) {
      case "snapshot": {
        const [stocks, settings, quotes] = await Promise.all([db("dashboard_stocks?order=added_at.asc"), db("dashboard_settings?id=eq.true"), db("dashboard_quotes")]);
        const brands = await backfillBrands(stocks);
        return reply({ stocks: stocks.map((stock: { symbol: string; name: string }) => ({ ...stock, logo_url: brands.get(stock.symbol)?.logo_url ?? null })), greenUp: settings[0].green_up, quotes });
      }
      case "unlock": {
        if (!(await claim("unlock", "global"))) throw new ClientError("Too many unlock attempts. Please wait one minute.", 429);
        await sessionKey();
        if (typeof input.password !== "string" || !(await equal(input.password, env("ADMIN_PASSWORD")))) throw new ClientError("That password is incorrect. Please try again.", 401);
        return reply({ token: await token() });
      }
      case "preference":
        await authorize(request);
        if (typeof input.greenUp !== "boolean") throw new ClientError("Invalid color preference.");
        await db("dashboard_settings?id=eq.true", "PATCH", { green_up: input.greenUp });
        return reply({ ok: true });
      case "remove": {
        await authorize(request);
        const symbol = symbolOf(input.symbol);
        await db(`dashboard_stocks?symbol=eq.${encodeURIComponent(symbol)}`, "DELETE");
        return reply({ ok: true });
      }
      case "add": {
        await authorize(request);
        const symbol = symbolOf(input.symbol);
        const brand = await cachedBrand(symbol);
        if (!brand?.name) throw new ClientError("Could not find that US stock.");
        const result = await quote(symbol, false, brand.name);
        if (!result.quote) throw new ClientError(result.warning || "Could not find that stock.");
        await db("dashboard_stocks?on_conflict=symbol", "POST", { symbol, name: brand.name });
        return reply({ ...result, logo_url: brand.logo_url });
      }
      case "quote": {
        const symbol = symbolOf(input.symbol);
        const stocks = await db(`dashboard_stocks?symbol=eq.${encodeURIComponent(symbol)}&select=symbol,name`);
        if (!stocks.length) throw new ClientError("This stock is no longer in your watchlist.", 404);
        return reply(await quote(symbol, input.force === true, stocks[0].name));
      }
      case "details": {
        const symbol = symbolOf(input.symbol);
        const stocks = await db(`dashboard_stocks?symbol=eq.${encodeURIComponent(symbol)}&select=symbol,name`);
        if (!stocks.length) throw new ClientError("This stock is no longer in your watchlist.", 404);
        const [quoteResult, profileResult, newsResult, recommendationResult] = await Promise.all([
          quote(symbol, false, stocks[0].name),
          profile(symbol),
          news(symbol),
          recommendations(symbol),
        ]);
        return reply({
          quote: quoteResult.quote,
          profile: profileResult.data,
          news: newsResult.data ?? [],
          recommendations: recommendationResult.data,
          warnings: [quoteResult.warning, profileResult.warning, newsResult.warning, recommendationResult.warning].filter((warning): warning is string => Boolean(warning)),
        });
      }
      default: throw new ClientError("Unknown action.");
    }
  } catch (error) {
    return reply({ error: error instanceof ClientError ? error.message : "The dashboard is temporarily unavailable. Please try again." }, error instanceof ClientError ? error.status : 503);
  }
});
