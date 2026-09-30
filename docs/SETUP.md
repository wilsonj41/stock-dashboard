# Stock Dashboard setup

The frontend is ready, but live data requires the following Supabase setup. No additional JavaScript libraries are needed.

## 1. Create the database tables

Open your project's **SQL Editor**, paste the complete contents of `supabase/setup.sql`, and run it. This is a standalone setup script, not an automatically applied migration. It creates an empty shared watchlist, the color preference, quote and detail-data caches, a persistent company-logo cache, a public `dashboard-logos` Storage bucket, and backend rate-limit bookkeeping. Rerunning it preserves saved data.

All tables have RLS enabled and no browser access. The Edge Function uses server-only database credentials to provide public reads and password-protected edits. The publishable key cannot edit these tables directly.

## 2. Configure backend secrets

Create a personal Finnhub account at https://finnhub.io/ and obtain an API key. In **Supabase → Edge Functions → Secrets**, add:

| Name | Value |
| --- | --- |
| `FINNHUB_API_KEY` | Your Finnhub API key |
| `ADMIN_PASSWORD` | A unique password of at least 6 characters |

Supabase injects `SUPABASE_URL` and backend credentials. The function supports the injected `SUPABASE_SERVICE_ROLE_KEY` or the default entry in `SUPABASE_SECRET_KEYS`. Never put these credentials, the admin password, or the stock API key in a `VITE_` variable or frontend file.

Keep this personal dashboard within Finnhub's personal-use terms. Use a dedicated API key: quota tracking covers this dashboard's calls, not calls from other tools sharing the key. Provider entitlements may affect which US symbols return data.

## 3. Deploy the function in the browser

In **Supabase → Edge Functions**, create a function **via the editor**, named exactly `dashboard`.

Replace its `index.ts` with `supabase/functions/dashboard/index.ts` and deploy. No imports or dependency installation are needed.

Disable **Verify JWT** / **Enforce JWT verification** for this function. This app does not use Supabase Auth. The function implements its own admin authorization for every mutation; public viewing and refresh do not require an admin session. `supabase/config.toml` records this setting for future CLI deployments, but copying code into the dashboard does not apply that file automatically.

CORS allows requests from any origin; no origin allowlist secret is needed. Server-side token checks and database privileges protect edits.

## 4. Run the app

The root `.env` should contain the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Run `npm run dev` and open the URL printed by Vite.

Click **Edit My Stocks**, enter the admin password, and add a ticker such as `AAPL`. The same unlock permits additions, removals, and color changes. The password is cleared after unlocking. The returned bearer capability lives only in React memory; no cookies, localStorage, or sessionStorage are used. Reloading/closing the tab clears it. **Lock editing** also clears it from the page.

The capability has no timed expiry so a long tab session does not prompt again. A copied/stolen capability remains usable until `ADMIN_PASSWORD` changes. Changing the backend password revokes every issued capability. Treat the capability as a secret and serve the deployed site over HTTPS. The lock button clears the local capability; it does not revoke copies elsewhere.

## Data behavior

- Watchlist, color preference, and quote cache are stored only in Supabase.
- Company names and logos come from Finnhub's Company Profile 2 endpoint. Logos are downloaded server-side and stored in the public `dashboard-logos` Supabase Storage bucket; the database points only to the project’s Storage URL. The migration marks prior logo entries as legacy and replaces them on the next dashboard load. Price refreshes never retrieve logos.
- Other visible tabs synchronize the watchlist and preference every 15 seconds and when focused. These checks read Supabase, not Finnhub.
- Opening the app requests quotes. A quote fetched within 60 seconds is reused. There is no continuous stock API polling.
- Opening a stock detail page retrieves its company profile, recent news, and analyst recommendations. Those sanitized responses are stored in Supabase: company profiles for 24 hours, news for 15 minutes, and recommendations for 6 hours. The detail page also reuses the 60-second quote cache for today’s open and range.
- **Refresh** requests new quotes even inside the 60-second window, subject to the limits below.
- The backend enforces a shared 55-request rolling-minute budget for Finnhub quotes, company profiles, news, and recommendations, plus a 15-request-per-second burst guard. A per-symbol 20-second cooldown prevents simultaneous/repeated requests from draining the shared allowance. Exceeding a limit serves saved data with a notice; retry later.
- Failed retrievals preserve saved data; a symbol with no saved quote shows an explicit unavailable state. A stock must have a valid quote before it can be added.
- Quotes use the daily interval so change is calculated against the previous trading day's close. The card’s “Data retrieved …” timestamp comes from the server-generated `fetched_at` value and is converted only for display into each viewer’s local timezone. Cache freshness and all stored values continue to use the server timestamp. The provider’s market timestamp remains separate, so a refresh can show a new retrieval time even when the trading-day quote itself is unchanged.
- Informational refresh toasts remain visible at least 1.5 seconds; completion/error messages last 4.5 seconds. The gain/loss color setting never changes toast semantic colors.
- Five unlock attempts per rolling minute are allowed globally. Wait one minute after a limit message.

## Verification

Local checks: `npm run build`, `npm run lint`, and `node --test tests/dashboard.test.mjs`.

After setup, run `supabase/verify.sql` in the SQL Editor. Its test writes roll back. Then verify:

1. Load the site without unlocking: viewing works, and both Add and color changes prompt for the password.
2. A wrong password fails; a correct one unlocks stocks and colors together.
3. Add `AAPL`, change the color convention, and open another device: both changes appear.
4. Refresh twice quickly: the second call may show the cooldown message instead of spending another credit.
5. Reload: editing is locked, while stocks and colors remain saved.
6. Temporarily remove the Finnhub key in Supabase: cached quotes still display with a clear warning on Refresh; restore the secret afterward.

The live SQL and provider integration cannot be verified locally without your deployed backend and API key.

References: [Supabase dashboard deployment](https://supabase.com/docs/guides/functions/quickstart-dashboard), [function secrets](https://supabase.com/docs/guides/functions/secrets), [Finnhub API documentation](https://finnhub.io/docs/api/quote).
