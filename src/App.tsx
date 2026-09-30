import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, SubmitEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, currency, quoteDate } from "./utils/dashboard";
import type {
  DetailResult,
  Quote,
  QuoteResult,
  Snapshot,
  Stock,
} from "./utils/dashboard";
import "./css/style.css";

function Icon({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span
      key={name}
      aria-hidden="true"
      className={`inline-flex items-center justify-center ${className}`}
    >
      <i className={`fa-solid fa-${name}`} />
    </span>
  );
}
function StockLogo({ stock }: { stock: Stock }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xs font-bold tracking-tight text-slate-600">
      {stock.logo_url && !failed ? (
        <img
          src={stock.logo_url}
          alt=""
          className="size-full object-contain p-2"
          onError={() => setFailed(true)}
        />
      ) : (
        stock.symbol.slice(0, 3)
      )}
    </span>
  );
}
const button =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50";
type Notice = { text: string; kind: "info" | "success" | "error" };
function Toast({ notice }: { notice: Notice | null }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-4 top-24 z-50 mx-auto max-w-lg"
    >
      {notice && (
        <p
          className={`flex items-start gap-3 rounded-xl border px-5 py-4 text-sm shadow-lg ${notice.kind === "error" ? "border-red-200 bg-red-50 text-red-800" : notice.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}
        >
          <Icon
            name={
              notice.kind === "error"
                ? "triangle-exclamation"
                : notice.kind === "success"
                  ? "check"
                  : "circle-info"
            }
            className="mt-0.5"
          />
          {notice.text}
        </p>
      )}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  busy,
  notice,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
  notice: Notice | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 text-slate-900 backdrop:bg-slate-950/45 backdrop:backdrop-blur-sm"
      aria-labelledby="dialog-title"
    >
      <Toast notice={notice} />
      <div className="grid min-h-full place-items-center p-4">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-2xl">
          <header className="mb-5 flex items-center justify-between gap-4">
            <h2 id="dialog-title" className="text-xl font-bold">
              {title}
            </h2>
            <button
              onClick={onClose}
              disabled={busy}
              aria-label="Close dialog"
              className={`${button} px-2 text-slate-500 hover:bg-slate-100`}
            >
              <Icon name="xmark" />
            </button>
          </header>
          {children}
        </section>
      </div>
    </dialog>
  );
}

type DetailTab = "overview" | "news" | "recommendations";

const compactNumber = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);

function StockDetailPanel({
  stock,
  quote,
  detail,
  loading,
  error,
  greenUp,
  tab,
  onTabChange,
}: {
  stock: Stock;
  quote?: Quote;
  detail: DetailResult | null;
  loading: boolean;
  error: string;
  greenUp: boolean;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
}) {
  const currentQuote = detail?.quote ?? quote;
  const delta = currentQuote
    ? Number(currentQuote.price) - Number(currentQuote.previous_close)
    : 0;
  const positive = delta > 0;
  const negative = delta < 0;
  const changeColor = positive
    ? greenUp
      ? "text-emerald-700"
      : "text-red-600"
    : negative
      ? greenUp
        ? "text-red-600"
        : "text-emerald-700"
      : "text-slate-500";
  const tabs: { id: DetailTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "news", label: "News" },
    { id: "recommendations", label: "Recommendations" },
  ];
  const recommendation = detail?.recommendations;
  const recommendationTotal = recommendation
    ? recommendation.strong_buy +
      recommendation.buy +
      recommendation.hold +
      recommendation.sell +
      recommendation.strong_sell
    : 0;
  const consensus =
    recommendationTotal && recommendation
      ? [
          ["Strong buy", recommendation.strong_buy],
          ["Buy", recommendation.buy],
          ["Hold", recommendation.hold],
          ["Sell", recommendation.sell],
          ["Strong sell", recommendation.strong_sell],
        ].reduce((largest, rating) =>
          rating[1] > largest[1] ? rating : largest,
        )[0]
      : "No consensus";
  return (
    <section
      aria-labelledby="detail-title"
      className="mt-8 rounded-3xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-slate-200 px-6 py-6 sm:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <StockLogo stock={stock} />
          <div className="min-w-0">
            <h2
              id="detail-title"
              className="mt-1 text-2xl font-semibold tracking-tight"
            >
              {stock.symbol}
              <span className="ml-2 text-base font-normal text-slate-500">
                {stock.name}
              </span>
            </h2>
          </div>
        </div>
        <p className="text-right text-sm text-slate-500">
          <span className="block text-2xl font-semibold tabular-nums text-slate-900">
            {currentQuote ? currency(Number(currentQuote.price)) : "—"}
          </span>
          <span
            className={`mt-1 block font-semibold tabular-nums ${changeColor}`}
          >
            {currentQuote
              ? `${positive ? "+" : ""}${delta.toFixed(2)} (${positive ? "+" : ""}${((delta / Number(currentQuote.previous_close)) * 100).toFixed(2)}%)`
              : "Quote unavailable"}
          </span>
        </p>
      </header>
      <div className="border-b border-slate-200 px-6 sm:px-8">
        <div
          role="tablist"
          aria-label="Stock details"
          className="flex gap-1 overflow-x-auto"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`${item.id}-tab`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`${item.id}-panel`}
              onClick={() => onTabChange(item.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-emerald-600 ${tab === item.id ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-900"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-6 sm:p-8">
        {loading && (
          <p
            role="status"
            className="mb-6 flex items-center gap-2 text-sm text-slate-500"
          >
            <Icon name="rotate" className="motion-safe:animate-spin" />
            Loading the latest details…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            {error}
          </p>
        )}
        {tab === "overview" && (
          <div
            id="overview-panel"
            role="tabpanel"
            aria-labelledby="overview-tab"
          >
            <dl className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [
                  "Current price",
                  currentQuote ? currency(Number(currentQuote.price)) : "—",
                  "Latest quote",
                ],
                [
                  "Previous close",
                  currentQuote
                    ? currency(Number(currentQuote.previous_close))
                    : "—",
                  "Previous trading day",
                ],
                [
                  "Today’s open",
                  currentQuote?.open === null ||
                  currentQuote?.open === undefined
                    ? "—"
                    : currency(currentQuote.open),
                  "Latest quote",
                ],
                [
                  "Day range",
                  currentQuote?.low === null ||
                  currentQuote?.low === undefined ||
                  currentQuote.high === null ||
                  currentQuote.high === undefined
                    ? "—"
                    : `${currency(currentQuote.low)} – ${currency(currentQuote.high)}`,
                  "Latest quote",
                ],
                [
                  "Market capitalization",
                  detail?.profile?.market_cap === null ||
                  detail?.profile?.market_cap === undefined
                    ? "—"
                    : `${compactNumber(detail.profile.market_cap)} USD`,
                  "Company profile",
                ],
                [
                  "Industry",
                  detail?.profile?.industry ?? "—",
                  "Company profile",
                ],
                [
                  "Exchange",
                  detail?.profile?.exchange ?? "—",
                  "Company profile",
                ],
                [
                  "Last market update",
                  currentQuote ? quoteDate(currentQuote.market_at) : "—",
                  "Your local time",
                ],
              ].map(([label, value, source]) => (
                <div key={label} className="bg-white px-5 py-4">
                  <dt className="text-xs font-medium text-slate-500">
                    {label}
                  </dt>
                  <dd className="mt-2 font-semibold text-slate-900">{value}</dd>
                  <p className="mt-1 text-[11px] text-slate-400">{source}</p>
                </div>
              ))}
            </dl>
            {detail?.profile?.website && (
              <a
                href={detail.profile.website}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900"
              >
                Visit company website{" "}
                <Icon name="arrow-up-right-from-square" className="text-xs" />
              </a>
            )}
          </div>
        )}
        {tab === "news" && (
          <div id="news-panel" role="tabpanel" aria-labelledby="news-tab">
            {detail?.news.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {detail.news.map((article) => (
                  <article
                    key={article.id}
                    className="rounded-2xl border border-slate-200 p-5"
                  >
                    <p className="text-xs font-medium text-slate-400">
                      {article.source ?? "News"} ·{" "}
                      {quoteDate(article.published_at)}
                    </p>
                    <h3 className="mt-3 text-base font-semibold">
                      {article.headline}
                    </h3>
                    {article.summary && (
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">
                        {article.summary}
                      </p>
                    )}
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900"
                    >
                      Read original article{" "}
                      <Icon
                        name="arrow-up-right-from-square"
                        className="text-xs"
                      />
                    </a>
                  </article>
                ))}
              </div>
            ) : (
              !loading && (
                <p className="text-sm text-slate-500">
                  No recent stories are available for this stock.
                </p>
              )
            )}
          </div>
        )}
        {tab === "recommendations" && (
          <div
            id="recommendations-panel"
            role="tabpanel"
            aria-labelledby="recommendations-tab"
          >
            {recommendation ? (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <section
                  className="rounded-2xl bg-slate-900 p-6 text-white"
                  aria-label="Analyst consensus"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Consensus
                  </p>
                  <p className="mt-3 text-3xl font-semibold">{consensus}</p>
                  <p className="mt-2 text-sm text-slate-300">
                    {recommendationTotal} analyst ratings · Period ending{" "}
                    {recommendation.period}
                  </p>
                </section>
                <dl
                  className="grid grid-cols-5 gap-2"
                  aria-label="Recommendation distribution"
                >
                  {[
                    ["Strong buy", recommendation.strong_buy],
                    ["Buy", recommendation.buy],
                    ["Hold", recommendation.hold],
                    ["Sell", recommendation.sell],
                    ["Strong sell", recommendation.strong_sell],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-slate-200 px-3 py-4 text-center"
                    >
                      <dt className="text-[11px] font-medium leading-4 text-slate-500">
                        {label}
                      </dt>
                      <dd className="mt-3 text-xl font-semibold tabular-nums text-slate-900">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              !loading && (
                <p className="text-sm text-slate-500">
                  No analyst recommendation data is available for this stock.
                </p>
              )
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function App() {
  const navigate = useNavigate();
  const { stock: routeSymbol } = useParams<{ stock?: string }>();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [greenUp, setGreenUp] = useState(true);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [busySymbols, setBusySymbols] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState("");
  const tokenRef = useRef("");
  const [modal, setModal] = useState<"unlock" | "add" | null>(null);
  const [pending, setPending] = useState<"add" | "color" | null>(null);
  const [password, setPassword] = useState("");
  const [symbol, setSymbol] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshingRef = useRef(false);
  const syncing = useRef(false);
  const editing = useRef(false);
  const editRevision = useRef(0);
  const notify = useCallback(
    (text: string, kind: Notice["kind"], duration = 4500) => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      setNotice({ text, kind });
      if (duration)
        noticeTimer.current = setTimeout(() => setNotice(null), duration);
    },
    [],
  );
  const refreshQuotes = useCallback(
    async (list: Stock[], force: boolean) => {
      if (refreshingRef.current || !list.length) return;
      refreshingRef.current = true;
      setRefreshing(true);
      setBusySymbols(new Set(list.map((stock) => stock.symbol)));
      if (force) notify("Refreshing Data", "info", 0);
      const start = Date.now();
      let failures = 0;
      await Promise.all(
        list.map(async (stock) => {
          try {
            const result = await api<QuoteResult>({
              action: "quote",
              symbol: stock.symbol,
              force,
            });
            if (result.quote)
              setQuotes((previous) => ({
                ...previous,
                [stock.symbol]: result.quote!,
              }));
            setWarnings((previous) => ({
              ...previous,
              [stock.symbol]: result.warning || "",
            }));
            if (result.warning) failures++;
          } catch (error) {
            failures++;
            setWarnings((previous) => ({
              ...previous,
              [stock.symbol]:
                error instanceof Error
                  ? error.message
                  : "Unable to refresh this stock.",
            }));
          } finally {
            setBusySymbols((previous) => {
              const next = new Set(previous);
              next.delete(stock.symbol);
              return next;
            });
          }
        }),
      );
      if (force)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 1500 - (Date.now() - start))),
        );
      refreshingRef.current = false;
      setRefreshing(false);
      if (force)
        notify(
          failures
            ? "Some quotes could not refresh. Saved data is shown where available."
            : "Stock data is up to date.",
          failures ? "error" : "success",
        );
    },
    [notify],
  );
  const sync = useCallback(
    async (fetchQuotes = false) => {
      if (syncing.current || editing.current || refreshingRef.current) return;
      syncing.current = true;
      const revision = editRevision.current;
      try {
        const data = await api<Snapshot>({ action: "snapshot" });
        if (editing.current || revision !== editRevision.current) return;
        setStocks(data.stocks);
        setGreenUp(data.greenUp);
        setQuotes((previous) => ({
          ...previous,
          ...Object.fromEntries(data.quotes.map((q) => [q.symbol, q])),
        }));
        setReady(true);
        setLoadError("");
        if (fetchQuotes) void refreshQuotes(data.stocks, false);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unable to load your dashboard.",
        );
      } finally {
        syncing.current = false;
      }
    },
    [refreshQuotes],
  );
  useEffect(() => {
    void sync(true);
    const onFocus = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", onFocus);
    const interval = setInterval(onFocus, 15000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [sync]);
  useEffect(() => {
    if (!routeSymbol || !ready) return;
    const normalizedSymbol = routeSymbol.toUpperCase();
    if (!stocks.some((stock) => stock.symbol === normalizedSymbol)) {
      navigate("/", { replace: true });
      return;
    }

    // The stock is in the list
    if (routeSymbol !== normalizedSymbol) {
      navigate(`/${normalizedSymbol}`, { replace: true });
    }
  }, [navigate, ready, routeSymbol, stocks]);
  const selectedSymbol = routeSymbol?.toUpperCase() ?? null;
  const selectedStock = selectedSymbol
    ? stocks.find((stock) => stock.symbol === selectedSymbol)
    : undefined;
  const detailSymbol = selectedStock?.symbol;
  useEffect(() => {
    if (!selectedSymbol) return;
    setDetailTab("overview");
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [selectedSymbol]);
  useEffect(() => {
    if (!detailSymbol) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    void api<DetailResult>({ action: "details", symbol: detailSymbol })
      .then((result) => {
        if (cancelled) return;
        setDetail(result);
        if (result.quote)
          setQuotes((previous) => ({
            ...previous,
            [detailSymbol]: result.quote!,
          }));
      })
      .catch(() => {
        if (!cancelled)
          setDetailError(
            "Details could not be updated right now. Try again shortly.",
          );
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailSymbol]);
  function selectStock(stock: Stock) {
    setDetailTab("overview");
    navigate(`/${stock.symbol}`);
  }
  function closeModal() {
    setModal(null);
    setPassword("");
    setSymbol("");
    setFormError("");
  }
  function handleError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      setToken("");
      tokenRef.current = "";
    }
    return error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";
  }
  async function changeColor(adminToken = tokenRef.current) {
    editing.current = true;
    editRevision.current++;
    setSaving(true);
    try {
      await api({ action: "preference", greenUp: !greenUp }, adminToken);
      setGreenUp(!greenUp);
      notify("Color preference saved across your devices.", "success");
    } catch (error) {
      notify(handleError(error), "error");
    } finally {
      editing.current = false;
      setSaving(false);
    }
  }
  function requestEdit(action: "add" | "color") {
    setFormError("");
    if (!tokenRef.current) {
      setPending(action);
      setModal("unlock");
    } else if (action === "add") setModal("add");
    else void changeColor();
  }
  function openUnlock() {
    setPending(null);
    setFormError("");
    setModal("unlock");
  }
  async function unlock(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const result = await api<{ token: string }>({
        action: "unlock",
        password,
      });
      tokenRef.current = result.token;
      setToken(result.token);
      setPassword("");
      setModal(pending === "add" ? "add" : null);
      if (pending === "color") await changeColor(result.token);
      else notify("Editing unlocked for this tab session.", "success");
    } catch (error) {
      setFormError(handleError(error));
    } finally {
      setSaving(false);
    }
  }
  async function addStock(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    editing.current = true;
    editRevision.current++;
    setFormError("");
    const ticker = symbol.trim().toUpperCase();
    try {
      if (stocks.some((stock) => stock.symbol === ticker))
        throw new Error("You are already tracking this stock.");
      const result = await api<QuoteResult>(
        { action: "add", symbol: ticker },
        tokenRef.current,
      );
      if (!result.quote)
        throw new Error("No quote is available for this stock.");
      setStocks((previous) => [
        ...previous.filter((s) => s.symbol !== ticker),
        { symbol: ticker, name: result.quote!.name, logo_url: result.logo_url },
      ]);
      setQuotes((previous) => ({ ...previous, [ticker]: result.quote! }));
      setWarnings((previous) => ({
        ...previous,
        [ticker]: result.warning || "",
      }));
      closeModal();
      notify(
        result.warning || `${ticker} added to My Stocks.`,
        result.warning ? "error" : "success",
      );
    } catch (error) {
      setFormError(handleError(error));
    } finally {
      setSaving(false);
      editing.current = false;
    }
  }
  async function removeStock(stock: Stock) {
    editing.current = true;
    editRevision.current++;
    setSaving(true);
    try {
      await api({ action: "remove", symbol: stock.symbol }, tokenRef.current);
      setStocks((previous) =>
        previous.filter((s) => s.symbol !== stock.symbol),
      );
      if (selectedSymbol === stock.symbol) {
        navigate("/");
      }
      notify(`${stock.symbol} removed from My Stocks.`, "success");
    } catch (error) {
      notify(handleError(error), "error");
    } finally {
      editing.current = false;
      setSaving(false);
    }
  }
  const counts = stocks.reduce(
    (result, stock) => {
      const quote = quotes[stock.symbol];
      if (quote) {
        if (quote.price > quote.previous_close) result.up++;
        else if (quote.price < quote.previous_close) result.down++;
        else result.flat++;
      }
      return result;
    },
    { up: 0, down: 0, flat: 0 },
  );
  const upColor = greenUp ? "text-emerald-700" : "text-red-600";
  const downColor = greenUp ? "text-red-600" : "text-emerald-700";
  return (
    <div className="min-h-screen bg-[#f6f7f9] font-sans text-slate-900 selection:bg-emerald-200">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-slate-200 bg-white">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8 lg:px-12"
        >
          <a
            href="/"
            className="flex items-center gap-3 font-bold tracking-tight"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-lime-300">
              <Icon name="chart-line" />
            </span>
            <span className="text-lg">
              Stock
              <span className="font-normal text-slate-500"> Dashboard</span>
            </span>
          </a>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              role="switch"
              aria-checked={greenUp}
              aria-label={`Green indicates gains${token ? "" : "; admin password required to change"}`}
              title={
                token
                  ? "Change the shared gain/loss colors"
                  : "Unlock with the admin password to change colors"
              }
              disabled={!ready || saving}
              onClick={() => requestEdit("color")}
              className={`${button} border border-slate-200 bg-white hover:bg-slate-50`}
            >
              <span
                className={`flex h-5 w-9 items-center rounded-full p-0.5 ${greenUp ? "bg-emerald-600" : "bg-red-500"}`}
              >
                <span
                  className={`size-4 rounded-full bg-white transition-transform ${greenUp ? "translate-x-4" : "translate-x-0"}`}
                />
              </span>
              <span className="text-xs">
                {greenUp ? "Green" : "Red"} = gains
              </span>
              {!token && (
                <Icon name="lock" className="text-xs text-slate-400" />
              )}
            </button>
            <button
              onClick={() => void refreshQuotes(stocks, true)}
              disabled={!ready || refreshing || !stocks.length || saving}
              className={`${button} border border-slate-200 hover:bg-slate-50`}
            >
              <Icon
                name="rotate"
                className={refreshing ? "motion-safe:animate-spin" : ""}
              />
              <span className="hidden sm:inline">Refresh</span>
              <span className="sr-only sm:hidden">Refresh stock data</span>
            </button>
            {token ? (
              <button
                onClick={() => {
                  tokenRef.current = "";
                  setToken("");
                  notify("Editing locked.", "info");
                }}
                className={`${button} bg-emerald-50 text-emerald-800`}
              >
                <Icon name="unlock" />
                <span>Lock editing</span>
              </button>
            ) : (
              <button
                disabled={!ready}
                onClick={openUnlock}
                className={`${button} bg-slate-900 text-white hover:bg-slate-700`}
              >
                <Icon name="lock" />
                Edit
              </button>
            )}
          </div>
        </nav>
      </header>
      {!modal && <Toast notice={notice} />}
      <main className="mx-auto max-w-7xl px-5 py-10 pt-40 sm:px-8 sm:pt-32 lg:px-12 lg:py-14 lg:pt-36">
        {selectedStock ? (
          <section aria-labelledby="detail-page-title">
            <button
              type="button"
              onClick={() => navigate("/")}
              className={`${button} mb-7 border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            >
              <Icon name="arrow-left" />
              Back to My Stocks
            </button>
            <h1 id="detail-page-title" className="sr-only">
              {selectedStock.symbol} details
            </h1>
            <StockDetailPanel
              stock={selectedStock}
              quote={quotes[selectedStock.symbol]}
              detail={detail}
              loading={detailLoading}
              error={detailError || detail?.warnings[0] || ""}
              greenUp={greenUp}
              tab={detailTab}
              onTabChange={setDetailTab}
            />
          </section>
        ) : (
          <section aria-labelledby="stocks-title">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
              <div>
                <h1
                  id="stocks-title"
                  className="text-2xl font-semibold tracking-tight sm:text-3xl"
                >
                  My Stocks<span className="text-emerald-600">.</span>
                </h1>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  disabled={!ready || saving || refreshing}
                  onClick={() => requestEdit("add")}
                  className={`${button} bg-slate-900 text-white hover:bg-slate-700`}
                >
                  <Icon name="plus" />
                  <span>Add a stock</span>
                  {!token && (
                    <Icon name="lock" className="text-xs text-slate-300" />
                  )}
                </button>
                <p className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600">
                  <span className="size-1.5 rounded-full bg-slate-400" />
                  US equities<span className="text-slate-300">/</span>USD
                </p>
              </div>
            </div>
            <dl className="mb-8 grid grid-cols-2 divide-x divide-slate-200 rounded-2xl border border-slate-200 bg-white py-5 sm:grid-cols-4">
              {[
                [
                  "Tracking",
                  ready ? String(stocks.length) : "—",
                  "text-slate-900",
                ],
                ["Advancing", ready ? String(counts.up) : "—", upColor],
                ["Declining", ready ? String(counts.down) : "—", downColor],
                [
                  "Unchanged",
                  ready ? String(counts.flat) : "—",
                  "text-slate-500",
                ],
              ].map(([label, value, color]) => (
                <div key={label} className="px-5 py-2 sm:px-7">
                  <dt className="text-xs font-medium text-slate-500">
                    {label}
                  </dt>
                  <dd
                    className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <p>Price changes vs. previous trading day’s close</p>
            </div>
            {loadError && (
              <aside
                role="alert"
                className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
              >
                <p className="font-semibold">
                  {ready
                    ? "Sync is temporarily unavailable"
                    : "Connect your dashboard"}
                </p>
                <p className="mt-2 leading-6">{loadError}</p>
                <button
                  onClick={() => void sync(true)}
                  className={`${button} mt-3 border border-red-200 bg-white`}
                >
                  Try again
                </button>
              </aside>
            )}
            {!ready && !loadError && (
              <p role="status" className="py-12 text-center text-slate-500">
                <Icon name="rotate" className="mr-2 motion-safe:animate-spin" />
                Loading your watchlist…
              </p>
            )}
            {ready && (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {stocks.map((stock) => {
                  const q = quotes[stock.symbol],
                    loading = busySymbols.has(stock.symbol);
                  const delta = q
                    ? Number(q.price) - Number(q.previous_close)
                    : 0;
                  const positive = delta > 0,
                    negative = delta < 0;
                  const color = positive
                    ? upColor
                    : negative
                      ? downColor
                      : "text-slate-500";
                  return (
                    <article
                      key={stock.symbol}
                      aria-busy={loading}
                      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-emerald-300"
                    >
                      <button
                        type="button"
                        aria-label={`Show details for ${stock.symbol}`}
                        disabled={loading}
                        onClick={() => selectStock(stock)}
                        className={`block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 disabled:cursor-not-allowed ${loading ? "opacity-30" : ""}`}
                      >
                        <header className="flex items-start gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <StockLogo stock={stock} />
                            <div className="min-w-0">
                              <h2 className="font-bold">{stock.symbol}</h2>
                              <p
                                className="truncate text-xs text-slate-500"
                                title={stock.name}
                              >
                                {stock.name}
                              </p>
                            </div>
                          </div>
                        </header>
                        <p className="mt-7 text-4xl font-semibold tracking-tight tabular-nums">
                          {q ? currency(Number(q.price)) : "—"}
                        </p>
                        <p
                          className={`mt-3 flex items-center gap-2 text-sm font-semibold tabular-nums ${color}`}
                        >
                          <Icon
                            name={
                              positive
                                ? "arrow-up"
                                : negative
                                  ? "arrow-down"
                                  : "minus"
                            }
                          />
                          {q
                            ? `${positive ? "+" : ""}${delta.toFixed(2)} (${positive ? "+" : ""}${((delta / Number(q.previous_close)) * 100).toFixed(2)}%)`
                            : "Quote unavailable"}
                        </p>
                        <footer className="mt-6 border-t border-slate-100 pt-4">
                          <p className="text-[11px] text-slate-500">
                            {q ? (
                              <>
                                Data retrieved{" "}
                                <time dateTime={q.fetched_at}>
                                  {quoteDate(q.fetched_at)}
                                </time>
                              </>
                            ) : (
                              "No saved data yet"
                            )}
                          </p>
                          {warnings[stock.symbol] && (
                            <p className="mt-2 text-xs leading-5 text-amber-800">
                              <Icon
                                name="triangle-exclamation"
                                className="mr-1"
                              />
                              {warnings[stock.symbol]}
                            </p>
                          )}
                        </footer>
                      </button>
                      {token && (
                        <button
                          aria-label={`Remove ${stock.symbol}`}
                          disabled={saving || refreshing || loading}
                          onClick={() => void removeStock(stock)}
                          className="absolute right-4 top-4 z-10 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-600 disabled:opacity-40"
                        >
                          <Icon name="trash" />
                        </button>
                      )}
                      {loading && (
                        <div
                          role="status"
                          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/40 text-sm font-medium text-slate-600"
                        >
                          <span className="size-7 rounded-full border-2 border-slate-200 border-t-emerald-600 motion-safe:animate-spin" />
                          Updating {stock.symbol}…
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
        <aside className="mt-8 flex items-start gap-3 rounded-xl bg-slate-100 px-5 py-4 text-xs leading-6 text-slate-500">
          <Icon name="circle-info" className="mt-1" />
          <p>
            Prices may be delayed. Refresh updates the latest available data.
            Retrieval times use your local timezone.
          </p>
        </aside>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6 text-[11px] text-slate-400">
          <p>
            Market data by{" "}
            <a
              href="https://finnhub.io"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-slate-700"
            >
              Finnhub
            </a>
          </p>
        </footer>
      </main>
      {modal === "unlock" && (
        <Modal
          title="Unlock your dashboard"
          onClose={closeModal}
          busy={saving}
          notice={notice}
        >
          <p className="mb-6 text-sm leading-6 text-slate-500">
            Enter the admin password once to edit stocks and colors in this tab.
            Reloading or closing the tab locks editing again.
          </p>
          <p className="mb-6 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
            Demo Password: 123456
          </p>
          <form onSubmit={unlock}>
            <label htmlFor="password" className="text-sm font-semibold">
              Admin password
            </label>
            <input
              autoFocus
              required
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-emerald-600"
            />
            {formError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {formError}
              </p>
            )}
            <button
              disabled={saving}
              className={`${button} mt-6 w-full bg-slate-900 text-white`}
            >
              {saving ? "Unlocking…" : "Unlock editing"}
              <Icon name="arrow-right" />
            </button>
          </form>
        </Modal>
      )}
      {modal === "add" && (
        <Modal
          title="Add to My Stocks"
          onClose={closeModal}
          busy={saving}
          notice={notice}
        >
          <p className="mb-6 text-sm leading-6 text-slate-500">
            Enter a US stock ticker. We’ll check its quote before adding it to
            your shared watchlist.
          </p>
          <form onSubmit={addStock}>
            <label htmlFor="ticker" className="text-sm font-semibold">
              Ticker symbol
            </label>
            <input
              autoFocus
              required
              id="ticker"
              placeholder="e.g. AAPL"
              maxLength={15}
              autoComplete="off"
              spellCheck={false}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={saving}
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 uppercase outline-emerald-600"
            />
            {formError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {formError}
              </p>
            )}
            <button
              disabled={saving || !symbol.trim()}
              className={`${button} mt-6 w-full bg-slate-900 text-white`}
            >
              {saving ? "Checking stock…" : "Add stock"}
              <Icon name="plus" />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
export default App;
