import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";

const source = ts.transpileModule(
  readFileSync("supabase/functions/dashboard/index.ts", "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } },
).outputText;
const saved = {
  symbol: "AAPL",
  name: "Apple Inc",
  price: 200,
  previous_close: 198,
  market_at: "2026-09-28T14:00:00Z",
  fetched_at: new Date().toISOString(),
};

function setup({ cached = saved, reserve = true, providerFails = false, profileCountry = "US" } = {}) {
  let handler;
  let quoteCalls = 0;
  let profileCalls = 0;
  let newsCalls = 0;
  let recommendationCalls = 0;
  const writes = [];
  const logoCache = [];
  const detailCache = [];
  const secrets = {
    ADMIN_PASSWORD: "a-test-password-long-enough",
    SUPABASE_URL: "https://db.test",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    FINNHUB_API_KEY: "test",
  };
  vm.runInNewContext(source, {
    Deno: { env: { get: (key) => secrets[key] }, serve: (value) => { handler = value; } },
    TextEncoder,
    crypto: webcrypto,
    Uint8Array,
    URL,
    URLSearchParams,
    AbortSignal,
    Response,
    Request,
    fetch: async (url, options = {}) => {
      const target = String(url);
      if (target.startsWith("https://finnhub.io/api/v1")) {
        const parsed = new URL(target);
        assert.equal(parsed.searchParams.get("token"), "test");
        if (parsed.pathname === "/api/v1/stock/profile2") {
          profileCalls++;
          return Response.json({ ticker: "AAPL", country: profileCountry, name: "Apple Inc", logo: "https://static.finnhub.io/logo/apple.png" });
        }
        if (parsed.pathname === "/api/v1/quote") {
          quoteCalls++;
          if (providerFails) throw new Error("Offline");
          return Response.json({ c: 201, pc: 198, o: 199, h: 202, l: 197, t: 1790612400 });
        }
        if (parsed.pathname === "/api/v1/company-news") {
          newsCalls++;
          return Response.json([{ id: 1, headline: "Apple update", summary: "Company news summary.", source: "Example News", url: "https://news.test/apple", datetime: 1790612400 }]);
        }
        if (parsed.pathname === "/api/v1/stock/recommendation") {
          recommendationCalls++;
          return Response.json([{ period: "2026-09-01", strongBuy: 10, buy: 5, hold: 2, sell: 1, strongSell: 0 }]);
        }
      }
      if (target === "https://static.finnhub.io/logo/apple.png") {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
      }
      if (target.includes("rpc/dashboard_claim")) return Response.json(reserve);
      if (target.includes("/storage/v1/object/dashboard-logos/")) return Response.json({ Key: "dashboard-logos/AAPL" }, { status: 200 });
      if (target.includes("dashboard_quotes")) {
        if (options.method !== "GET") writes.push({ url: target, body: options.body });
        return Response.json(cached ? [cached] : []);
      }
      if (target.includes("dashboard_detail_cache")) {
        if (options.method !== "GET") {
          writes.push({ url: target, body: options.body });
          const row = JSON.parse(options.body);
          const index = detailCache.findIndex((cachedRow) => cachedRow.symbol === row.symbol && cachedRow.kind === row.kind);
          if (index >= 0) detailCache[index] = row;
          else detailCache.push(row);
        }
        const parsed = new URL(target);
        const symbol = parsed.searchParams.get("symbol")?.replace("eq.", "");
        const kind = parsed.searchParams.get("kind")?.replace("eq.", "");
        return Response.json(detailCache.filter((row) => (!symbol || row.symbol === symbol) && (!kind || row.kind === kind)));
      }
      if (target.includes("dashboard_logos")) {
        if (options.method !== "GET") {
          writes.push({ url: target, body: options.body });
          const row = JSON.parse(options.body);
          logoCache.splice(0, logoCache.length, row);
        }
        return Response.json(logoCache);
      }
      if (target.includes("dashboard_stocks")) return Response.json([{ symbol: "AAPL", name: "Apple Inc" }]);
      if (target.includes("dashboard_settings")) return Response.json([{ green_up: true }]);
      throw new Error(`Unexpected URL: ${target}`);
    },
  });
  return {
    writes,
    secrets,
    quoteCalls: () => quoteCalls,
    profileCalls: () => profileCalls,
    newsCalls: () => newsCalls,
    recommendationCalls: () => recommendationCalls,
    call: async (body, token = "", origin = "http://localhost:5173") => {
      const result = await handler(new Request("https://db.test/functions/v1/dashboard", { method: "POST", headers: { origin, "x-admin-token": token }, body: JSON.stringify(body) }));
      return { status: result.status, headers: result.headers, body: await result.json() };
    },
  };
}

test("all edits reject absent or forged admin tokens before writing", async () => {
  const app = setup();
  for (const action of ["add", "remove", "preference"]) {
    assert.equal((await app.call({ action, symbol: "AAPL", greenUp: false })).status, 401);
    assert.equal((await app.call({ action, symbol: "AAPL", greenUp: false }, "forged")).status, 401);
  }
  assert.equal(app.writes.length, 0);
});

test("one unlock authorizes both stocks and colors; password rotation revokes it", async () => {
  const app = setup();
  assert.equal((await app.call({ action: "unlock", password: "wrong" })).status, 401);
  const { body } = await app.call({ action: "unlock", password: app.secrets.ADMIN_PASSWORD });
  assert.ok(body.token);
  assert.equal((await app.call({ action: "preference", greenUp: false }, body.token)).status, 200);
  assert.equal((await app.call({ action: "remove", symbol: "AAPL" }, body.token)).status, 200);
  app.secrets.ADMIN_PASSWORD = "rotated-password-long-enough";
  assert.equal((await app.call({ action: "remove", symbol: "AAPL" }, body.token)).status, 401);
});

test("fresh shared cache avoids Finnhub quote calls", async () => {
  const app = setup();
  const result = await app.call({ action: "quote", symbol: "AAPL" });
  assert.equal(result.body.quote.price, 200);
  assert.equal(app.quoteCalls(), 0);
});

test("manual refresh saves Finnhub's quote timestamp", async () => {
  const app = setup();
  const result = await app.call({ action: "quote", symbol: "AAPL", force: true });
  assert.equal(app.quoteCalls(), 1);
  assert.equal(result.body.quote.price, 201);
  assert.equal(result.body.quote.market_at, new Date(1790612400 * 1000).toISOString());
  assert.ok(app.writes.some((write) => write.url.includes("dashboard_quotes") && JSON.parse(write.body).price === 201));
});

test("details returns cached company, news, and recommendation data", async () => {
  const app = setup();
  const first = await app.call({ action: "details", symbol: "AAPL" });
  assert.equal(first.status, 200);
  assert.equal(first.body.profile.industry, null);
  assert.equal(first.body.news[0].headline, "Apple update");
  assert.equal(first.body.recommendations.strong_buy, 10);
  assert.equal(app.newsCalls(), 1);
  assert.equal(app.recommendationCalls(), 1);
  const second = await app.call({ action: "details", symbol: "AAPL" });
  assert.equal(second.status, 200);
  assert.equal(app.newsCalls(), 1);
  assert.equal(app.recommendationCalls(), 1);
});

test("provider failures preserve the saved quote", async () => {
  const app = setup({ providerFails: true });
  const result = await app.call({ action: "quote", symbol: "AAPL", force: true });
  assert.deepEqual(result.body.quote, saved);
  assert.match(result.body.warning, /last saved/);
});

test("adding a stock caches its Finnhub profile and logo separately from quote refreshes", async () => {
  const app = setup({ cached: null });
  const token = (await app.call({ action: "unlock", password: app.secrets.ADMIN_PASSWORD })).body.token;
  const result = await app.call({ action: "add", symbol: "AAPL" }, token);
  assert.equal(result.status, 200);
  assert.equal(result.body.logo_url, "https://db.test/storage/v1/object/public/dashboard-logos/AAPL");
  assert.equal(app.profileCalls(), 1);
  assert.equal(app.quoteCalls(), 1);
  const second = await app.call({ action: "add", symbol: "AAPL" }, token);
  assert.equal(second.body.logo_url, "https://db.test/storage/v1/object/public/dashboard-logos/AAPL");
  assert.equal(app.profileCalls(), 1);
});

test("loading an older watchlist upgrades its brand cache once", async () => {
  const app = setup();
  const first = await app.call({ action: "snapshot" });
  assert.equal(first.body.stocks[0].logo_url, "https://db.test/storage/v1/object/public/dashboard-logos/AAPL");
  assert.equal(app.profileCalls(), 1);
  const second = await app.call({ action: "snapshot" });
  assert.equal(second.body.stocks[0].logo_url, "https://db.test/storage/v1/object/public/dashboard-logos/AAPL");
  assert.equal(app.profileCalls(), 1);
});

test("a non-US profile cannot be added", async () => {
  const app = setup({ cached: null, profileCountry: "CA" });
  const token = (await app.call({ action: "unlock", password: app.secrets.ADMIN_PASSWORD })).body.token;
  const result = await app.call({ action: "add", symbol: "AAPL" }, token);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /US stock/);
  assert.equal(app.quoteCalls(), 0);
});

test("quota rejection never calls Finnhub, including forced refresh", async () => {
  const app = setup({ reserve: false });
  const result = await app.call({ action: "quote", symbol: "AAPL", force: true });
  assert.equal(app.quoteCalls(), 0);
  assert.match(result.body.warning, /could not be refreshed/);
  assert.equal((await app.call({ action: "unlock", password: app.secrets.ADMIN_PASSWORD })).status, 429);
});

test("any origin can read but edits still require admin authorization", async () => {
  const app = setup();
  const result = await app.call({ action: "snapshot" }, "", "https://another-site.test");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await app.call({ action: "preference", greenUp: false }, "", "https://another-site.test")).status, 401);
});
