export type Stock = { symbol: string; name: string; logo_url?: string | null }
export type Quote = Stock & { price: number; previous_close: number; open?: number | null; high?: number | null; low?: number | null; market_at: string; fetched_at: string }
export type Snapshot = { stocks: Stock[]; quotes: Quote[]; greenUp: boolean }
export type QuoteResult = { quote: Quote | null; warning: string | null; logo_url?: string | null }
export type CompanyProfile = { market_cap: number | null; industry: string | null; exchange: string | null; website: string | null; shares_outstanding: number | null; ipo: string | null }
export type NewsArticle = { id: number; headline: string; summary: string | null; source: string | null; url: string; published_at: string }
export type Recommendation = { period: string; strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number }
export type DetailResult = { quote: Quote | null; profile: CompanyProfile | null; news: NewsArticle[]; recommendations: Recommendation | null; warnings: string[] }
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function api<T>(body: Record<string, unknown>, token = ''): Promise<T> {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('The dashboard is not ready yet. Please try again later.')
  let response: Response
  try {
    response = await fetch(`${url}/functions/v1/dashboard`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key, ...(token ? { 'x-admin-token': token } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    })
  } catch { throw new Error('Unable to connect right now. Check your connection and try again.') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(data.error || 'The dashboard is temporarily unavailable. Please try again.', response.status)
  return data as T
}
export const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
export function quoteDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}
