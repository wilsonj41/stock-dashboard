# Stock Dashboard

A personal US-stock watchlist built with React, Vite, declarative React Router, Tailwind CSS, Font Awesome, and Supabase.

## Setup

Follow [the Supabase setup guide](docs/SETUP.md). Run [setup.sql](supabase/setup.sql) in the Supabase SQL Editor, add the backend secrets, then deploy the [dashboard Edge Function](supabase/functions/dashboard/index.ts).

The watchlist, gain/loss color convention, and quote cache are shared across devices through Supabase. A single in-memory admin unlock protects stock and preference edits for the current tab. No browser storage is used.

## Development

```sh
npm run dev
npm run build
npm run lint
node --test tests/dashboard.test.mjs
```

The backend uses Finnhub's free personal plan, a 60-second quote cache, a shared request limit, and saved-quote fallback. Live operation requires your API key and deployed Supabase setup; it does not display fabricated stock data.
