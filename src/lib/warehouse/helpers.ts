import type { HistoryEntry, Lang, Material, MaterialStatus, OpType } from "./types";
import { t } from "./i18n";

/**
 * Accept only values the browser can load as an image without throwing
 * `net::ERR_INVALID_URL`. Rejects empty/"undefined"/"null", bare schemes,
 * and non-http(s)/non-data/non-blob/non-relative paths.
 */
export function isValidImageSrc(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const src = value.trim();
  if (!src || src === "undefined" || src === "null" || src === "false") return false;
  if (src.startsWith("data:image/")) {
    return src.length > 20 && src.includes(",");
  }
  if (src.startsWith("blob:")) return src.length > 10;
  if (src.startsWith("/")) return src.length > 1 && !src.includes("://");
  if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      const u = new URL(src);
      return Boolean(u.hostname) && (u.protocol === "http:" || u.protocol === "https:");
    } catch {
      return false;
    }
  }
  return false;
}

export function isActiveMaterial(item: Material) {
  return item.archived !== true && item.status !== "archived" && item.status !== "inactive";
}

export function firstActiveKey(store: Record<string, Material>): string {
  for (const [key, item] of Object.entries(store)) {
    if (isActiveMaterial(item)) return key;
  }
  return "";
}

/** Parse a spreadsheet/JSON quantity: blank, a non-negative integer, or invalid. */
export function parseOptionalNonNegInt(
  raw: unknown,
): { kind: "blank" } | { kind: "ok"; value: number } | { kind: "bad" } {
  if (raw === "" || raw === null || raw === undefined) return { kind: "blank" };
  if (typeof raw === "string" && raw.trim() === "") return { kind: "blank" };
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return { kind: "bad" };
  return { kind: "ok", value: n };
}


export function normalizeMaterialName(value: string) {
  return String(value)
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("und");
}

export function materialNameTokens(key: string, item: Pick<Material, "ar" | "fr" | "en">) {
  return [key, item.ar, item.fr, item.en]
    .map(normalizeMaterialName)
    .filter(Boolean);
}

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseQty(raw: string): number | null {
  const trimmed = String(raw).trim();
  if (!trimmed || !/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return null;
  return n;
}

export function sanitizeDocId(str: string) {
  const s = String(str).trim().replace(/[/.#$[\]]/g, "_").slice(0, 300);
  return s || `m_${Date.now()}`;
}

export function matchesSearch(key: string, item: Material, query: string) {
  const q = normalizeMaterialName(query);
  if (!q) return true;
  const blob = normalizeMaterialName(
    `${item.ar || ""} ${item.fr || ""} ${item.en || ""} ${item.section || ""} ${item.category || ""} ${key}`,
  );
  return blob.includes(q);
}

export function getName(item: Material, key: string, lang: Lang) {
  if (lang === "ar" && item.ar) return item.ar;
  if (lang === "en" && item.en) return item.en;
  if (lang === "fr" && item.fr) return item.fr;
  return item.ar || item.fr || item.en || key;
}

export function stockLevel(qty: number, minQty: number): "missing" | "low" | "med" | "ok" {
  const min = minQty > 0 ? minQty : 10;
  if (qty <= 0) return "missing";
  if (qty < min) return "low";
  if (qty < min * 5) return "med";
  return "ok";
}

export function stockColor(qty: number, minQty: number) {
  const level = stockLevel(qty, minQty);
  if (level === "missing") return "var(--color-bad)";
  if (level === "low") return "var(--color-warn)";
  if (level === "med") return "var(--color-mid)";
  return "var(--color-ok)";
}

export function stockLabel(qty: number, minQty: number, lang: Lang) {
  const level = stockLevel(qty, minQty);
  if (level === "missing") return t(lang, "statusMissing");
  if (level === "low") return t(lang, "statusLow");
  if (level === "med") return t(lang, "statusMed");
  return t(lang, "statusOK");
}

export function typeLabel(type: OpType, lang: Lang) {
  if (type === "in") return t(lang, "typeIn");
  if (type === "borrow") return t(lang, "typeBorrow");
  if (type === "return") return t(lang, "typeReturn");
  return t(lang, "typeOut");
}

export function entryTs(entry: HistoryEntry) {
  if (typeof entry.ts === "number" && Number.isFinite(entry.ts)) return entry.ts;
  const n = Number(entry.id);
  return Number.isFinite(n) ? n : 0;
}

export function todayISO() {
  return new Date().toISOString().split("T")[0] ?? "";
}

export function normalizeMaterial(data: Partial<Material> | Record<string, unknown>, key: string): Material {
  const d = data as Record<string, unknown>;
  const minRaw = Number(d.minQty);
  const rawStatus = String(d.status || "").toLowerCase();
  const status: MaterialStatus =
    d.archived === true || rawStatus === "archived"
      ? "archived"
      : rawStatus === "inactive"
        ? "inactive"
        : "active";
  const qtyRaw = Number(d.qty);
  const borrowedRaw = Number(d.borrowed);
  return {
    qty: Number.isFinite(qtyRaw) && qtyRaw >= 0 ? qtyRaw : 0,
    unit: String(d.unit || "قطعة"),
    borrowed: Number.isFinite(borrowedRaw) && borrowedRaw >= 0 ? borrowedRaw : 0,
    section: String(d.section || "office").trim() || "office",
    category: String(d.category || d.section || "office").trim() || "office",
    status,
    ar: String(d.ar || key),
    fr: String(d.fr || key),
    en: String(d.en || key),
    img: "",
    imgData: isValidImageSrc(d.imgData) && String(d.imgData).startsWith("data:image/") ? String(d.imgData) : "",
    imgUrl: isValidImageSrc(d.imgUrl) ? String(d.imgUrl).trim() : "",
    minQty: minRaw > 0 ? minRaw : 10,
    archived: status === "archived",
    updatedAt: Number(d.updatedAt) || 0,
  };
}

export function cloudPayload(key: string, item: Material) {
  const qty = Number(item.qty);
  const borrowed = Number(item.borrowed);
  const updatedAt = Number(item.updatedAt) || Date.now();
  return {
    key: String(key || "").slice(0, 390),
    qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
    unit: String(item.unit || "قطعة").slice(0, 40),
    borrowed: Number.isFinite(borrowed) && borrowed >= 0 ? borrowed : 0,
    section: String(item.section || "office").slice(0, 80),
    category: String(item.category || item.section || "office").slice(0, 80),
    status: item.status || (item.archived ? "archived" : "active"),
    ar: String(item.ar || key).slice(0, 200),
    fr: String(item.fr || key).slice(0, 200),
    en: String(item.en || key).slice(0, 200),
    minQty: item.minQty > 0 ? Number(item.minQty) : 10,
    imgUrl: isValidImageSrc(item.imgUrl) ? item.imgUrl.trim().slice(0, 500) : "",
    imgData:
      isValidImageSrc(item.imgData) && item.imgData.startsWith("data:image/") ? item.imgData : "",
    archived: item.archived === true,
    updatedAt,
  };
}

export function idle(cb: () => void, timeout = 400) {
  const ric = window.requestIdleCallback;
  if (typeof ric === "function") return ric(cb, { timeout }) as unknown as number;
  return window.setTimeout(cb, 200);
}

export function cancelIdle(handle: number) {
  const cic = window.cancelIdleCallback;
  if (typeof cic === "function") cic(handle);
  else window.clearTimeout(handle);
}
