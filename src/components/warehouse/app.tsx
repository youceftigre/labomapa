"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ClipboardCheck,
  ClipboardPen,
  Cloud,
  CloudOff,
  Download,
  History,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Package,
  Search,
  Settings2,
  Upload,
  Warehouse,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  destroyWarehouse,
  dismissToast,
  exportJson,
  importJsonFile,
  initWarehouse,
  login,
  logout,
  retrySync,
  setLang,
  setSearch,
  setTab,
} from "@/lib/warehouse/engine";
import { t, type I18nKey } from "@/lib/warehouse/i18n";
import { isActiveMaterial } from "@/lib/warehouse/helpers";
import { useWarehouse } from "@/lib/warehouse/state";
import type { Lang, TabId } from "@/lib/warehouse/types";
import { DashboardPanel, InventoryPanel } from "./dashboard";
import { BorrowPanel, CountPanel, HistoryPanel, ManagePanel, RegisterPanel } from "./panels";
import { EditModal } from "./edit-modal";

const TABS: { id: TabId; key: I18nKey; icon: typeof LayoutDashboard; operator?: boolean; admin?: boolean }[] = [
  { id: "dashboard", key: "tabDashboard", icon: LayoutDashboard },
  { id: "register", key: "tabRegister", icon: ClipboardPen, operator: true },
  { id: "inventory", key: "tabInventory", icon: Package },
  { id: "borrow", key: "tabBorrow", icon: ArrowLeftRight, operator: true },
  { id: "count", key: "tabCount", icon: ClipboardCheck, operator: true },
  { id: "history", key: "tabHistory", icon: History },
  { id: "manage", key: "tabManage", icon: Settings2, admin: true },
];

export function WarehouseApp() {
  const ready = useWarehouse((s) => s.ready);
  const isAuthenticated = useWarehouse((s) => s.isAuthenticated);
  const role = useWarehouse((s) => s.role);
  const lang = useWarehouse((s) => s.lang);
  const tab = useWarehouse((s) => s.tab);
  const search = useWarehouse((s) => s.search);

  useEffect(() => {
    void initWarehouse();
    return () => destroyWarehouse();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "ar" ? "ar" : lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const visibleTabs = useMemo(
    () =>
      TABS.filter(
        (item) =>
          (!item.admin || role === "admin") &&
          (!item.operator || role === "operator" || role === "admin"),
      ),
    [role],
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-navy-deep text-ink">
        <LoginOverlay />
        <ToastStack />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-deep text-ink">
      <div className="mx-auto max-w-6xl">
        <TopBar />
        <SyncBar />
        <Header />
        <StatsRow />

        <div className="px-3 pb-2 sm:px-4">
          <label className="flex items-center gap-2 rounded-md border border-white/10 bg-navy px-3 py-2 text-paper">
            <Search className="size-4 shrink-0 opacity-70" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(lang, "searchPlaceholder")}
              className="w-full bg-transparent text-sm text-paper outline-none placeholder:text-paper/50"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} className="text-paper/70 hover:text-paper">
                <X className="size-4" />
              </button>
            ) : null}
          </label>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-white/10 bg-navy-deep/80 px-2">
          {visibleTabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition",
                  active
                    ? "border-paper bg-white/10 font-semibold text-paper"
                    : "border-transparent text-paper/70 hover:bg-white/5 hover:text-paper",
                )}
              >
                <Icon className="size-4" />
                {t(lang, item.key)}
              </button>
            );
          })}
        </nav>

        <main className="px-3 py-4 sm:px-4">
          {!ready ? (
            <div className="flex items-center justify-center gap-2 py-16 text-paper/80">
              <LoaderCircle className="size-5 animate-spin" />
              {t(lang, "syncSyncing")}
            </div>
          ) : (
            <>
              {tab === "dashboard" ? <DashboardPanel /> : null}
              {tab === "register" && (role === "operator" || role === "admin") ? <RegisterPanel /> : null}
              {tab === "inventory" ? <InventoryPanel /> : null}
              {tab === "borrow" && (role === "operator" || role === "admin") ? <BorrowPanel /> : null}
              {tab === "count" && (role === "operator" || role === "admin") ? <CountPanel /> : null}
              {tab === "history" ? <HistoryPanel /> : null}
              {tab === "manage" && role === "admin" ? <ManagePanel /> : null}
            </>
          )}
        </main>

        <footer className="px-4 pb-8 pt-2 text-center text-xs text-paper/70">
          <p>
            MAPA İNŞAAT ve TİCARET A.Ş. · {t(lang, "footerText")} · <Clock lang={lang} />
          </p>
          <p className="mt-1 font-semibold tracking-wide text-gold">{t(lang, "signature")}</p>
        </footer>
      </div>

      <EditModal />
      <ToastStack />
    </div>
  );
}

function ToastStack() {
  const toasts = useWarehouse((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed top-4 z-50 flex w-full max-w-sm flex-col gap-2 px-3 start-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md px-3 py-3 text-sm text-white shadow-lg",
            toast.type === "success" && "bg-ok",
            toast.type === "error" && "bg-bad",
            toast.type === "warning" && "bg-warn",
            toast.type === "info" && "bg-cyan",
          )}
        >
          <span className="flex-1 whitespace-pre-line text-pretty">{toast.message}</span>
          <button type="button" onClick={() => dismissToast(toast.id)} className="opacity-80 hover:opacity-100">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

function TopBar() {
  const lang = useWarehouse((s) => s.lang);
  const role = useWarehouse((s) => s.role);
  const jsonRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-navy-deep/90 px-3 py-2 sm:px-4">
      <span className="rounded-full border border-gold/40 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-gold">
        {t(lang, role === "admin" ? "roleAdmin" : role === "operator" ? "roleOperator" : "roleViewer")}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="chip" onClick={() => exportJson()} title={t(lang, "exportJson")}>
          <Download className="size-3.5" />
          {t(lang, "exportJson")}
        </button>
        {role === "admin" ? (
          <>
            <button type="button" className="chip" onClick={() => jsonRef.current?.click()}>
              <Upload className="size-3.5" />
              {t(lang, "importJson")}
            </button>
            <input
              ref={jsonRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importJsonFile(file);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
        <button type="button" className="chip" onClick={logout}>
          <LogOut className="size-3.5" />
          {t(lang, "logout")}
        </button>
        <div className="flex gap-1">
          {(["ar", "fr", "en"] as Lang[]).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={cn("chip", lang === code && "bg-paper text-ink")}
            >
              {code === "ar" ? "العربية" : code === "fr" ? "Français" : "English"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SyncBar() {
  const lang = useWarehouse((s) => s.lang);
  const status = useWarehouse((s) => s.syncStatus);
  const lastSuccessAt = useWarehouse((s) => s.syncMetadata.lastSuccessAt);
  const label =
    status === "online"
      ? t(lang, "syncOnline")
      : status === "offline"
        ? t(lang, "syncOffline")
        : status === "error"
          ? t(lang, "syncError")
          : t(lang, "syncSyncing");

  // Offline-first: detect network changes and auto-sync when back online.
  useEffect(() => {
    const onOnline = () => {
      void retrySync();
    };
    const onOffline = () => {
      // Reflect offline immediately in the UI (local data stays safe).
      useWarehouse.setState({ syncStatus: "offline" });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // Initial state
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      useWarehouse.setState({ syncStatus: "offline" });
    }
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const canRetry = status === "error" || status === "offline";

  return (
    <button
      type="button"
      onClick={() => {
        if (canRetry || status === "online") void retrySync();
      }}
      className="flex w-full items-center gap-2 bg-navy px-4 py-2 text-start text-xs text-paper/90"
      title={canRetry ? t(lang, "syncRetry") : undefined}
    >
      {status === "online" ? (
        <Cloud className="size-3.5 text-ok" />
      ) : status === "syncing" ? (
        <LoaderCircle className="size-3.5 animate-spin text-cyan" />
      ) : (
        <CloudOff className="size-3.5 text-warn" />
      )}
      <span className="flex-1">{label}</span>
      {canRetry ? (
        <span className="rounded border border-paper/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
          {t(lang, "syncRetry")}
        </span>
      ) : null}
      {lastSuccessAt > 0 ? (
        <span className="opacity-70">
          {t(lang, "lastSync")}: {new Date(lastSuccessAt).toLocaleTimeString(lang === "ar" ? "ar-EG" : lang)}
        </span>
      ) : null}
    </button>
  );
}

function Header() {
  const lang = useWarehouse((s) => s.lang);
  return (
    <header className="bg-navy px-4 pb-6 pt-5 text-center text-paper">
      <div className="mx-auto mb-3 flex max-w-2xl flex-wrap items-center justify-center gap-4">
        <div className="flex max-w-md flex-col items-center rounded-lg bg-cyan px-5 py-3 shadow-lg">
          <img src="/mapa-logo.png" alt="MAPA" className="h-16 w-auto object-contain sm:h-20" />
          <div className="mt-1 text-sm font-bold tracking-wide">{t(lang, "companyName")}</div>
        </div>
        <div className="signature-text" dir="ltr" aria-label="By Youcef.B">by Youcef.B</div>
      </div>
      <h1 className="text-balance text-2xl font-bold sm:text-3xl">{t(lang, "appTitle")}</h1>
      <p className="mt-1 text-sm text-paper/80">{t(lang, "appSubtitle")}</p>
    </header>
  );
}

function StatsRow() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const history = useWarehouse((s) => s.history);
  const items = Object.values(inventory).filter(isActiveMaterial);
  const totalQty = items.reduce((s, i) => s + (i.qty || 0), 0);
  const lowStock = items.filter((i) => i.qty < (i.minQty || 10) && i.qty >= 0).length;
  const borrowed = items.reduce((s, i) => s + (i.borrowed || 0), 0);

  const cards = [
    { n: totalQty, k: "totalQty" as const },
    { n: lowStock, k: "lowStock" as const },
    { n: items.length, k: "totalItems" as const },
    { n: history.length, k: "totalOps" as const },
    { n: borrowed, k: "borrowedCount" as const },
  ];

  return (
    <section className="grid grid-cols-2 gap-2 px-3 py-4 sm:grid-cols-5 sm:px-4">
      {cards.map((c) => (
        <div key={c.k} className="rounded-md border border-white/15 bg-white/10 px-3 py-3 text-center text-paper">
          <div className="text-2xl font-bold tabular-nums">{c.n}</div>
          <div className="mt-1 text-[11px] text-paper/75">{t(lang, c.k)}</div>
        </div>
      ))}
    </section>
  );
}

function Clock({ lang }: { lang: Lang }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!now) return <span className="tabular-nums">—</span>;
  const locale = lang === "ar" ? "ar-EG" : lang === "fr" ? "fr-FR" : "en-US";
  return (
    <span className="tabular-nums">
      {now.toLocaleString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        numberingSystem: "latn",
      })}
    </span>
  );
}

function LoginOverlay() {
  const lang = useWarehouse((s) => s.lang);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    const ok = await login(password);
    setBusy(false);
    if (!ok) {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-navy-deep/90 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg bg-card p-6 text-center shadow-2xl">
        <Warehouse className="mx-auto mb-2 size-10 text-cyan" />
        <h2 className="text-xl font-bold text-navy">{t(lang, "loginTitle")}</h2>
        <p className="mt-1 mb-4 text-sm text-muted">{t(lang, "loginSub")}</p>
        <input
          type="password"
          value={password}
          dir="ltr"
          autoComplete="current-password"
          placeholder={t(lang, "passwordPlaceholder")}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onSubmit();
          }}
          className="mb-3 w-full rounded-md border-2 border-line px-3 py-2 text-left text-base outline-none focus:border-navy"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSubmit()}
          className="w-full rounded-md bg-navy py-2.5 text-base font-bold text-paper disabled:opacity-60"
        >
          {t(lang, "loginBtn")}
        </button>
        {error ? (
          <p className="mt-2 flex items-center justify-center gap-1 text-sm text-bad">
            <AlertTriangle className="size-4" />
            {t(lang, "loginError")}
          </p>
        ) : null}
        <p className="mt-5 border-t border-line pt-3 text-xs text-muted">
          <span className="font-semibold tracking-wide text-gold">{t(lang, "signature")}</span>
        </p>
      </div>
    </div>
  );
}
