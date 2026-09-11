import { getApp, getApps, initializeApp } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  type Firestore,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { checkAuth, loginWithPassword, logoutSession } from "./auth";
import { defaultOffice, firebaseConfig } from "./defaults";
import { t } from "./i18n";
import { idbDelete, idbGetAll, idbSet } from "./idb";
import { compressDataUrl } from "./images";
import {
  cancelIdle,
  cloudPayload,
  idle,
  isActiveMaterial,
  isValidImageSrc,
  materialNameTokens,
  newId,
  normalizeMaterial,
  normalizeMaterialName,
  parseOptionalNonNegInt,
  parseQty,
  sanitizeDocId,
  todayISO,
} from "./helpers";
import { useWarehouse } from "./state";
import type {
  HistoryEntry,
  InventoryFilter,
  Lang,
  Material,
  MaterialStatus,
  OpType,
  SyncMetadata,
  SyncStatus,
  TabId,
  UserRole,
} from "./types";
import { loadSheetJS } from "./xlsx";

let inventory: Record<string, Material> = {};
let history: HistoryEntry[] = [];
let borrowHistory: HistoryEntry[] = [];
let syncedMaterialSnapshots: Record<string, string> = {};
let hasAppliedMaterialSnapshot = false;
let syncedHistoryIds = new Set<string>();
let syncedBorrowIds = new Set<string>();
let isSyncing = false;
let cloudEnabled = false;
let db: Firestore | null = null;
/** Timestamp of the last local inventory mutation that was pushed (import/edit). */
let lastLocalWriteAt = 0;
/** After a full import, the next sync deletes cloud docs not present locally. */
let purgeCloudExtras = false;
/** Max history / borrow rows pulled from cloud listeners (keeps mobile light). */
const CLOUD_LOG_LIMIT = 300;
/** Prevent snapshot-triggered sync storms right after a successful push. */
const SYNC_COOLDOWN_MS = 1800;
let lastSyncCompletedAt = 0;

let unsubs: Unsubscribe[] = [];

function loadSyncFlags() {
  try {
    const raw = localStorage.getItem("warehouseSyncFlags");
    if (!raw) return;
    const flags = JSON.parse(raw) as { purgeCloudExtras?: boolean; lastLocalWriteAt?: number };
    if (flags.purgeCloudExtras) purgeCloudExtras = true;
    if (typeof flags.lastLocalWriteAt === "number" && flags.lastLocalWriteAt > 0) {
      lastLocalWriteAt = flags.lastLocalWriteAt;
    }
  } catch {
    /* ignore */
  }
}

function saveSyncFlags() {
  try {
    localStorage.setItem(
      "warehouseSyncFlags",
      JSON.stringify({ purgeCloudExtras, lastLocalWriteAt }),
    );
  } catch {
    /* ignore */
  }
}
  const pending: {
  materials: QuerySnapshot | null;
  history: QuerySnapshot | null;
  borrow: QuerySnapshot | null;
} = { materials: null, history: null, borrow: null };
let idleHandle: number | null = null;

function lang(): Lang {
  return useWarehouse.getState().lang;
}

function admin(): boolean {
  return useWarehouse.getState().role === "admin";
}

function operator(): boolean {
  const role = useWarehouse.getState().role;
  return role === "operator" || role === "admin";
}

export function showToast(
  message: string,
  type: "success" | "error" | "warning" | "info" = "info",
  duration = 4000,
) {
  const id = newId();
  const toasts = [...useWarehouse.getState().toasts, { id, message, type }];
  useWarehouse.setState({ toasts });
  window.setTimeout(() => {
    useWarehouse.setState({
      toasts: useWarehouse.getState().toasts.filter((x) => x.id !== id),
    });
  }, duration);
}

export function dismissToast(id: string) {
  useWarehouse.setState({
    toasts: useWarehouse.getState().toasts.filter((x) => x.id !== id),
  });
}

function updateSyncStatus(status: SyncStatus) {
  useWarehouse.setState({ syncStatus: status });
}

function updateSyncMetadata(patch: Partial<SyncMetadata>) {
  const syncMetadata = { ...useWarehouse.getState().syncMetadata, ...patch };
  useWarehouse.setState({ syncMetadata });
  try {
    localStorage.setItem("warehouseSyncMetadata", JSON.stringify(syncMetadata));
  } catch {
    /* metadata is best effort */
  }
}

function pushData() {
  useWarehouse.setState({
    inventory: { ...inventory },
    history: history.slice(),
    borrowHistory: borrowHistory.slice(),
  });
}

function saveToStorage() {
  const slim: Record<string, Omit<Material, "img">> = {};
  for (const [key, item] of Object.entries(inventory)) {
    const { img: _ignored, ...rest } = item;
    void _ignored;
    slim[key] = rest;
  }
  try {
    localStorage.setItem("inventory", JSON.stringify(slim));
    localStorage.setItem("history", JSON.stringify(history));
    localStorage.setItem("borrowHistory", JSON.stringify(borrowHistory));
  } catch {
    showToast(t(lang(), "quotaError"), "warning");
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadFromStorage() {
  const saved = readJson<Record<string, Partial<Material>> | null>("inventory", null);
  if (saved && typeof saved === "object") {
    const next: Record<string, Material> = {};
    for (const [key, value] of Object.entries(saved)) {
      next[key] = normalizeMaterial(value, key);
    }
    inventory = next;
  } else {
    inventory = structuredClone(defaultOffice);
  }
  history = normalizeEntries(readJson<HistoryEntry[]>("history", []));
  borrowHistory = normalizeEntries(readJson<HistoryEntry[]>("borrowHistory", []));
  const syncMetadata = readJson<SyncMetadata>("warehouseSyncMetadata", {
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastCloudAppliedAt: 0,
    lastErrorAt: 0,
  });
  useWarehouse.setState({ syncMetadata });
}

function normalizeEntries(list: unknown): HistoryEntry[] {
  if (!Array.isArray(list)) return [];
  return list.map((raw) => {
    const e = raw as Partial<HistoryEntry> & { id?: string | number };
    const id = String(e.id ?? newId());
    const ts = typeof e.ts === "number" ? e.ts : Number(e.id) || Date.now();
    const type = (e.type as OpType) || "out";
    const source = e.source;
    return {
      id,
      ts,
      material: String(e.material || ""),
      qty: Number(e.qty) || 0,
      employee: String(e.employee || ""),
      date: String(e.date || ""),
      type,
      section: String(e.section || "office"),
      note: e.note ? String(e.note) : undefined,
      source: source || undefined,
      sealed: e.sealed !== false,
    };
  });
}

/** Append-only merge: existing ids are never overwritten or removed. */
function mergeAppendOnly(existing: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const e of existing) byId.set(String(e.id), e);
  for (const e of incoming) {
    const id = String(e.id);
    if (!byId.has(id)) byId.set(id, e);
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/** Only way to add operations — never mutates or deletes prior entries. */
function appendHistory(entry: HistoryEntry, alsoBorrow = false) {
  const sealed: HistoryEntry = {
    ...entry,
    id: String(entry.id || newId()),
    sealed: true,
  };
  if (history.some((h) => String(h.id) === sealed.id)) return; // ignore duplicate id
  history.push(sealed);
  if (alsoBorrow) {
    if (!borrowHistory.some((h) => String(h.id) === sealed.id)) {
      borrowHistory.push(sealed);
    }
  }
}

async function hydrateImages() {
  try {
    const images = await idbGetAll();
    for (const key of Object.keys(inventory)) {
      const cached = images[key];
      const cloudImage = inventory[key].imgData;
      const remoteUrl = inventory[key].imgUrl;
      let resolved = "";
      if (isValidImageSrc(cached)) resolved = cached;
      else if (isValidImageSrc(cloudImage)) resolved = cloudImage;
      else if (isValidImageSrc(remoteUrl)) resolved = remoteUrl;
      inventory[key].img = resolved;
      if (!isValidImageSrc(inventory[key].imgData)) inventory[key].imgData = "";
      if (!isValidImageSrc(inventory[key].imgUrl)) inventory[key].imgUrl = "";
    }
  } catch (err) {
    console.warn("idb hydrate", err);
    for (const key of Object.keys(inventory)) {
      if (!isValidImageSrc(inventory[key].imgData) && !isValidImageSrc(inventory[key].imgUrl)) {
        inventory[key].img = "";
      }
    }
  }
}

/** Firestore Spark image storage: compressed data URLs are stored in the material document. */
async function uploadImage(_key: string, dataUrl: string): Promise<string> {
  const bytes = Math.floor((dataUrl.length * 3) / 4);
  if (bytes > 700 * 1024) {
    throw new Error("Image is too large for Firestore; please use a smaller image");
  }
  return dataUrl;
}

async function uploadImageWithRetry(
  key: string,
  dataUrl: string,
  _attempts = 3,
): Promise<string> {
  return uploadImage(key, dataUrl);
}

async function persistImage(key: string, dataUrl: string) {
  const compressed = await compressDataUrl(dataUrl);
  if (!inventory[key]) throw new Error("Material not found");

  // Spark-compatible cloud persistence: the compressed image is stored in Firestore.
  const cloudImage = await uploadImageWithRetry(key, compressed);
  inventory[key].imgData = cloudImage;
  inventory[key].imgUrl = "";
  inventory[key].img = cloudImage;
  inventory[key].updatedAt = Date.now();

  await idbSet(key, compressed).catch((err) => console.warn("idb cache set", err));
}

/** Firestore rejects `undefined` field values — strip them before writes. */
function firestoreDoc(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function historyCloudPayload(entry: HistoryEntry): Record<string, unknown> {
  const type = entry.type;
  const safeType =
    type === "in" || type === "out" || type === "borrow" || type === "return" ? type : "out";
  const material = String(entry.material || "").trim() || "unknown";
  const qty = Math.abs(Number(entry.qty));
  return firestoreDoc({
    id: String(entry.id || newId()),
    ts: Number(entry.ts) || Date.now(),
    material,
    qty: Number.isFinite(qty) ? qty : 0,
    employee: String(entry.employee || "").slice(0, 200),
    date: String(entry.date || ""),
    type: safeType,
    section: String(entry.section || "office").slice(0, 80),
    note: entry.note ? String(entry.note).slice(0, 500) : null,
    source: entry.source || null,
    sealed: true,
  });
}

let syncInFlight: Promise<void> | null = null;
let syncQueued = false;

function canSyncNow(force = false): boolean {
  if (!cloudEnabled || !db) return false;
  if (force) return true;
  return Date.now() - lastSyncCompletedAt >= SYNC_COOLDOWN_MS;
}

async function syncToCloud(force = false) {
  if (!cloudEnabled || !db) return;
  if (!force && !canSyncNow()) {
    // Cooldown active — queue a single follow-up if nothing is already flying.
    if (!syncInFlight) {
      syncQueued = true;
      window.setTimeout(() => {
        if (syncQueued) {
          syncQueued = false;
          void syncToCloud(true).catch(() => {});
        }
      }, SYNC_COOLDOWN_MS);
    }
    return;
  }
  // Serialize concurrent sync calls (import + snapshot resync can overlap).
  if (syncInFlight) {
    syncQueued = true;
    try {
      await syncInFlight;
    } catch {
      /* previous attempt logged its own error */
    }
    if (!syncQueued) return;
    syncQueued = false;
  }
  syncInFlight = runSyncToCloud().finally(() => {
    syncInFlight = null;
  });
  await syncInFlight;
  if (syncQueued) {
    syncQueued = false;
    await syncToCloud(true);
  }
}

async function runSyncToCloud() {
  if (!cloudEnabled || !db) return;
  updateSyncStatus("syncing");
  updateSyncMetadata({ lastAttemptAt: Date.now() });
  const ops: Array<
    | { type: "set"; ref: ReturnType<typeof doc>; data: Record<string, unknown> }
    | { type: "delete"; ref: ReturnType<typeof doc> }
  > = [];

  const currentKeys = new Set(Object.keys(inventory));
  for (const key of Object.keys(syncedMaterialSnapshots)) {
    if (!currentKeys.has(key)) {
      ops.push({ type: "delete", ref: doc(db, "wh_materials", sanitizeDocId(key)) });
    }
  }
  for (const key of currentKeys) {
    const payload = firestoreDoc(cloudPayload(key, inventory[key]) as Record<string, unknown>);
    const json = JSON.stringify(payload);
    if (syncedMaterialSnapshots[key] !== json) {
      ops.push({
        type: "set",
        ref: doc(db, "wh_materials", sanitizeDocId(key)),
        data: payload,
      });
    }
  }

  // Append-only log in the app: only missing ids are written (set = create or no-op overwrite).
  // Rules still forbid delete so operations cannot be erased from the cloud.
  const currentHistoryIds = new Set(history.map((h) => String(h.id)));
  for (const entry of history) {
    const idStr = String(entry.id);
    if (!syncedHistoryIds.has(idStr)) {
      ops.push({
        type: "set",
        ref: doc(db, "wh_history", sanitizeDocId(idStr)),
        data: historyCloudPayload(entry),
      });
    }
  }

  const currentBorrowIds = new Set(borrowHistory.map((h) => String(h.id)));
  for (const entry of borrowHistory) {
    const idStr = String(entry.id);
    if (!syncedBorrowIds.has(idStr)) {
      ops.push({
        type: "set",
        ref: doc(db, "wh_borrowHistory", sanitizeDocId(idStr)),
        data: historyCloudPayload(entry),
      });
    }
  }

  // After a full import, delete every cloud material that is not in the local
  // inventory (by key or by product name). This removes legacy duplicate docs
  // created by key sanitization mismatches.
  if (purgeCloudExtras) {
    try {
      const allCloud = await getDocs(collection(db, "wh_materials"));
      const deleteIds = new Set<string>();
      allCloud.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const key = String(data.key || d.id);
        if (currentKeys.has(key)) return;
        const mat = normalizeMaterial(data, key);
        if (findKeyByNameTokens(inventory, materialNameTokens(key, mat))) {
          deleteIds.add(d.id);
          return;
        }
        deleteIds.add(d.id);
      });
      for (const id of deleteIds) {
        ops.push({ type: "delete", ref: doc(db, "wh_materials", id) });
      }
    } catch (err) {
      console.warn("purgeCloudExtras scan failed:", err);
    }
  }

  function isTransientNetworkError(err: unknown): boolean {
    const code = (err as { code?: string })?.code || "";
    const msg = String((err as Error)?.message || err).toLowerCase();
    return (
      code === "unavailable" ||
      code === "deadline-exceeded" ||
      code === "resource-exhausted" ||
      /network|offline|fetch|timeout|unavailable|failed to fetch/i.test(msg)
    );
  }

  async function commitWithRetry(fn: () => Promise<void>, attempts = 3): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        await fn();
        return;
      } catch (err) {
        lastErr = err;
        if (!isTransientNetworkError(err) || i === attempts - 1) throw err;
        await new Promise((r) => setTimeout(r, 400 * (i + 1) * (i + 1)));
      }
    }
    throw lastErr;
  }

  try {
    // Deduplicate ops by ref path (last write wins).
    const byPath = new Map<string, (typeof ops)[number]>();
    for (const op of ops) {
      byPath.set(op.ref.path, op);
    }
    const uniqueOps = [...byPath.values()];

    for (let i = 0; i < uniqueOps.length; i += 450) {
      const chunk = uniqueOps.slice(i, i + 450);
      await commitWithRetry(async () => {
        const batch = writeBatch(db!);
        for (const op of chunk) {
          if (op.type === "set") batch.set(op.ref, op.data);
          else batch.delete(op.ref);
        }
        await batch.commit();
      });
    }

    syncedMaterialSnapshots = {};
    for (const key of currentKeys) {
      syncedMaterialSnapshots[key] = JSON.stringify(
        firestoreDoc(cloudPayload(key, inventory[key]) as Record<string, unknown>),
      );
    }
    for (const id of currentHistoryIds) syncedHistoryIds.add(id);
    for (const id of currentBorrowIds) syncedBorrowIds.add(id);
    purgeCloudExtras = false;
    lastLocalWriteAt = Date.now();
    lastSyncCompletedAt = Date.now();
    saveSyncFlags();
    updateSyncStatus("online");
    updateSyncMetadata({ lastSuccessAt: Date.now() });
  } catch (err) {
    console.error("Sync error:", err);
    updateSyncStatus("error");
    updateSyncMetadata({ lastErrorAt: Date.now() });
    const code = (err as { code?: string })?.code || "";
    const msg = String((err as Error)?.message || err).slice(0, 160);
    showToast(`${t(lang(), "syncError")}${code ? ` (${code})` : ""}`, "error", 8000);
    console.warn("Sync detail:", msg);
    throw err;
  }
}

/** Manual / auto retry after network errors. Safe to call anytime. */
export async function retrySync(): Promise<boolean> {
  if (!cloudEnabled || !db) {
    updateSyncStatus("offline");
    return false;
  }
  try {
    updateSyncStatus("syncing");
    await syncToCloud(true);
    return true;
  } catch {
    updateSyncStatus("error");
    return false;
  }
}

function findKeyByNameTokens(
  store: Record<string, Material>,
  tokens: string[],
  excludeKey?: string,
): string | null {
  if (!tokens.length) return null;
  for (const [candidate, item] of Object.entries(store)) {
    if (excludeKey && candidate === excludeKey) continue;
    const candidateTokens = materialNameTokens(candidate, item);
    if (candidateTokens.some((name) => tokens.includes(name))) return candidate;
  }
  return null;
}

/** Keep one entry per product name (ar/fr/en/key), preferring the newest updatedAt. */
function dedupeMaterialsByName(store: Record<string, Material>): Record<string, Material> {
  const entries = Object.entries(store).sort((a, b) => {
    const byTime = (Number(b[1].updatedAt) || 0) - (Number(a[1].updatedAt) || 0);
    if (byTime) return byTime;
    return a[0].localeCompare(b[0], "und");
  });
  const out: Record<string, Material> = {};
  const used = new Set<string>();
  for (const [key, item] of entries) {
    const tokens = materialNameTokens(key, item);
    if (tokens.some((name) => used.has(name))) continue;
    tokens.forEach((name) => used.add(name));
    out[key] = item;
  }
  return out;
}

function mergeMaterialsSnapshot(snap: QuerySnapshot) {
  const localCount = Object.keys(inventory).length;
  const cloudCount = snap.size;
  const recentWrite = lastLocalWriteAt > 0 && Date.now() - lastLocalWriteAt < 20_000;

  // Right after import/edit, a stale smaller cloud snapshot must not wipe local rows.
  if (recentWrite && localCount > cloudCount && localCount > 0) {
    if (canSyncNow()) {
      void syncToCloud().catch((err) => console.warn("resync after stale snapshot:", err));
    }
    return;
  }

  const next: Record<string, Material> = {};
  const remoteSnapshots: Record<string, string> = {};
  let needsResync = false;

  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const preferredKey = String(data.key || d.id).trim() || d.id;
    let mat = normalizeMaterial(data, preferredKey);
    const tokens = materialNameTokens(preferredKey, mat);

    // Collapse aliases onto an existing local/next key with the same product name.
    const key =
      (inventory[preferredKey] ? preferredKey : null) ||
      findKeyByNameTokens(inventory, tokens) ||
      findKeyByNameTokens(next, tokens) ||
      preferredKey;

    if (typeof data.imgData === "string" && data.imgData.startsWith("data:")) {
      mat.imgData = data.imgData;
      mat.img = data.imgData;
      void idbSet(key, data.imgData);
    } else if (typeof data.img === "string" && data.img.startsWith("data:")) {
      mat.imgData = data.img;
      mat.img = data.img;
      void idbSet(key, data.img);
    }

    const prev = inventory[key] || next[key];
    const localUpdatedAt = Number(prev?.updatedAt) || 0;
    const cloudUpdatedAt = Number(mat.updatedAt) || 0;

    if (prev && localUpdatedAt > cloudUpdatedAt) {
      mat = { ...prev };
      needsResync = true;
    } else {
      if (prev?.img && prev.imgData === mat.imgData) mat.img = prev.img;
      else if (mat.imgData) mat.img = mat.imgData;
      else if (mat.imgUrl) mat.img = mat.imgUrl;
    }

    // Drop any other key already in `next` that is the same product.
    const dup = findKeyByNameTokens(next, materialNameTokens(key, mat), key);
    if (dup) {
      delete next[dup];
      delete remoteSnapshots[dup];
      needsResync = true;
    }

    next[key] = mat;
    remoteSnapshots[key] = JSON.stringify(cloudPayload(key, mat));
  });

  // Keep only true offline/local adds that never matched a cloud product name
  // and were never part of a previous sync snapshot.
  for (const [key, local] of Object.entries(inventory)) {
    if (next[key]) continue;
    const tokens = materialNameTokens(key, local);
    if (findKeyByNameTokens(next, tokens)) continue;

    const localUpdatedAt = Number(local.updatedAt) || 0;
    const neverSynced = !Object.prototype.hasOwnProperty.call(syncedMaterialSnapshots, key);
    if ((!hasAppliedMaterialSnapshot || neverSynced) && localUpdatedAt > 0) {
      next[key] = local;
      needsResync = true;
    }
  }

  inventory = dedupeMaterialsByName(next);
  // Rebuild snapshots only for keys we kept.
  const cleanedSnapshots: Record<string, string> = {};
  for (const key of Object.keys(inventory)) {
    if (remoteSnapshots[key]) cleanedSnapshots[key] = remoteSnapshots[key];
  }
  syncedMaterialSnapshots = cleanedSnapshots;
  hasAppliedMaterialSnapshot = true;
  updateSyncMetadata({ lastCloudAppliedAt: Date.now() });

  if (needsResync && cloudEnabled && db && !isSyncing && canSyncNow()) {
    void syncToCloud().catch((err) => console.warn("resync after merge:", err));
  }
}

function mergeHistorySnapshot(snap: QuerySnapshot) {
  // Immutable log: union by id only — never overwrite or drop existing rows.
  const incoming: HistoryEntry[] = [];
  const cloudIds = new Set<string>();
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const entry = normalizeEntries([{ ...data, id: data.id ?? d.id }])[0];
    if (entry) {
      incoming.push(entry);
      cloudIds.add(String(entry.id));
    }
  });
  const before = history.length;
  history = mergeAppendOnly(history, incoming);
  // Mark cloud-seen ids as synced; local-only ids stay unsynced so they upload.
  for (const id of cloudIds) syncedHistoryIds.add(id);
  if (history.length > before || history.some((h) => !syncedHistoryIds.has(String(h.id)))) {
    if (canSyncNow()) void syncToCloud().catch((err) => console.warn("history append-sync:", err));
  }
}

function mergeBorrowSnapshot(snap: QuerySnapshot) {
  // Immutable log: union by id only.
  const incoming: HistoryEntry[] = [];
  const cloudIds = new Set<string>();
  snap.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const entry = normalizeEntries([{ ...data, id: data.id ?? d.id }])[0];
    if (entry) {
      incoming.push(entry);
      cloudIds.add(String(entry.id));
    }
  });
  const before = borrowHistory.length;
  borrowHistory = mergeAppendOnly(borrowHistory, incoming);
  for (const id of cloudIds) syncedBorrowIds.add(id);
  if (
    borrowHistory.length > before ||
    borrowHistory.some((h) => !syncedBorrowIds.has(String(h.id)))
  ) {
    if (canSyncNow()) void syncToCloud().catch((err) => console.warn("borrow append-sync:", err));
  }
}

function scheduleCloudApply() {
  if (idleHandle != null) return;
  idleHandle = idle(() => {
    idleHandle = null;
    if (isSyncing) {
      scheduleCloudApply();
      return;
    }
    let changed = false;
    if (pending.materials) {
      mergeMaterialsSnapshot(pending.materials);
      pending.materials = null;
      changed = true;
    }
    if (pending.history) {
      mergeHistorySnapshot(pending.history);
      pending.history = null;
      changed = true;
    }
    if (pending.borrow) {
      mergeBorrowSnapshot(pending.borrow);
      pending.borrow = null;
      changed = true;
    }
    if (!changed) return;
    saveToStorage();
    pushData();
    updateSyncStatus("online");
  });
}

async function migrateOldDataIfNeeded() {
  if (!db) return false;
  try {
    const matSnap = await getDocs(collection(db, "wh_materials"));
    if (!matSnap.empty) return false;
    const oldSnap = await getDoc(doc(db, "warehouse", "data"));
    if (!oldSnap.exists()) return false;
    const oldData = oldSnap.data() as {
      inventory?: Record<string, Partial<Material>>;
      history?: HistoryEntry[];
      borrowHistory?: HistoryEntry[];
    };
    const oldInventory = oldData.inventory || {};
    const oldHistory = normalizeEntries(oldData.history || []);
    const oldBorrow = normalizeEntries(oldData.borrowHistory || []);
    if (Object.keys(oldInventory).length === 0 && oldHistory.length === 0 && oldBorrow.length === 0) {
      return false;
    }
    const ops: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
    for (const key of Object.keys(oldInventory)) {
      const mat = normalizeMaterial(oldInventory[key]!, key);
      const rawImg = oldInventory[key]?.img;
      if (typeof rawImg === "string" && rawImg.startsWith("data:")) {
        const compressed = await compressDataUrl(rawImg);
        mat.imgData = await uploadImageWithRetry(key, compressed);
        mat.img = mat.imgData;
      }
      ops.push({ ref: doc(db, "wh_materials", sanitizeDocId(key)), data: cloudPayload(key, mat) });
    }
    for (const entry of oldHistory) {
      ops.push({ ref: doc(db, "wh_history", String(entry.id)), data: { ...entry } });
    }
    for (const entry of oldBorrow) {
      ops.push({ ref: doc(db, "wh_borrowHistory", String(entry.id)), data: { ...entry } });
    }
    for (let i = 0; i < ops.length; i += 450) {
      const chunk = ops.slice(i, i + 450);
      const batch = writeBatch(db);
      for (const op of chunk) batch.set(op.ref, op.data);
      await batch.commit();
    }
    return true;
  } catch (err) {
    console.error("Migration error:", err);
    return false;
  }
}

function isBenignFirestoreListenError(err: unknown) {
  const rec = err as { code?: string; message?: string } | null;
  const code = String(rec?.code || "").toLowerCase();
  const msg = String(rec?.message || "").toLowerCase();
  return (
    code.includes("cancelled") ||
    code.includes("aborted") ||
    msg.includes("aborted") ||
    msg.includes("the client has already been terminated") ||
    msg.includes("unsubscribe")
  );
}

function detachListeners() {
  for (const u of unsubs) {
    try { u(); } catch { /* ignore */ }
  }
  unsubs = [];
}

function attachListeners() {
  if (!db) return;
  detachListeners();
  unsubs.push(
    onSnapshot(
      collection(db, "wh_materials"),
      (snap) => {
        if (isSyncing) return;
        if (snap.metadata.hasPendingWrites) return;
        if (snap.empty) {
          void seedIfEmpty();
          return;
        }
        if (purgeCloudExtras) {
          void syncToCloud().catch((err) => console.warn("purge sync:", err));
          return;
        }
        pending.materials = snap;
        scheduleCloudApply();
      },
      (err) => {
        if (isBenignFirestoreListenError(err)) return;
        console.error("Materials snapshot error:", err);
        updateSyncStatus("offline");
      },
    ),
  );
  unsubs.push(
    onSnapshot(
      query(collection(db, "wh_history"), orderBy("ts", "desc"), limit(CLOUD_LOG_LIMIT)),
      (snap) => {
        if (isSyncing) return;
        if (snap.metadata.hasPendingWrites) return;
        pending.history = snap;
        scheduleCloudApply();
      },
      (err) => {
        if (isBenignFirestoreListenError(err)) return;
        console.error("History snapshot error:", err);
      },
    ),
  );
  unsubs.push(
    onSnapshot(
      query(collection(db, "wh_borrowHistory"), orderBy("ts", "desc"), limit(CLOUD_LOG_LIMIT)),
      (snap) => {
        if (isSyncing) return;
        if (snap.metadata.hasPendingWrites) return;
        pending.borrow = snap;
        scheduleCloudApply();
      },
      (err) => {
        if (isBenignFirestoreListenError(err)) return;
        console.error("BorrowHistory snapshot error:", err);
      },
    ),
  );
}

async function seedIfEmpty() {
  // Firebase may have been cleared externally. Reset snapshots so every
  // local record is written back instead of being considered already synced.
  syncedMaterialSnapshots = {};
  syncedHistoryIds = new Set();
  syncedBorrowIds = new Set();
  if (Object.keys(inventory).length === 0) inventory = structuredClone(defaultOffice);
  saveToStorage();
  pushData();
  try {
    await syncToCloud();
  } catch {
    /* local only */
  }
}

export async function initWarehouse() {
  if (typeof window === "undefined") return;
  const isAdmin = checkAuth();
  const storedRole = sessionStorage.getItem("warehouse_role");
  const role: UserRole = isAdmin
    ? storedRole === "operator" || storedRole === "viewer" || storedRole === "admin"
      ? storedRole
      : "admin"
    : "viewer";
  const savedLangRaw = (() => {
    try {
      return localStorage.getItem("warehouseLang");
    } catch {
      return null;
    }
  })();
  const savedLang: Lang =
    savedLangRaw === "ar" || savedLangRaw === "fr" || savedLangRaw === "en" ? savedLangRaw : "ar";
  useWarehouse.setState({
    isAdmin,
    isAuthenticated: isAdmin || Boolean(storedRole),
    role,
    lang: savedLang,
    ready: false,
    syncStatus: "syncing",
  });
  document.documentElement.lang = savedLang === "ar" ? "ar" : savedLang;
  document.documentElement.dir = savedLang === "ar" ? "rtl" : "ltr";
  loadFromStorage();
  loadSyncFlags();
  inventory = dedupeMaterialsByName(inventory);
  await hydrateImages();
  pushData();

  try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey.length > 10) {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      db = getFirestore(app);
      cloudEnabled = true;
    }
  } catch (err) {
    console.warn("Firebase init failed:", err);
    cloudEnabled = false;
  }

  if (cloudEnabled && db) {
    try {
      await migrateOldDataIfNeeded();
      // If a previous import marked local inventory as authoritative, purge any
      // extra cloud docs before listeners can overwrite the local count.
      // Only when the import purge flag is still set — never just because this
      // device wrote recently (that deleted other users' new materials).
      if (Object.keys(inventory).length > 0 && purgeCloudExtras) {
        try {
          await syncToCloud();
        } catch (err) {
          console.warn("startup purge failed:", err);
        }
      }
      attachListeners();
      if (!(window as any).__mapaWarehouseUnloadBound) {
        (window as any).__mapaWarehouseUnloadBound = true;
        const teardown = () => detachListeners();
        window.addEventListener("pagehide", teardown);
        window.addEventListener("beforeunload", teardown);
      }
    } catch (err) {
      console.error("Load from Firebase error:", err);
      updateSyncStatus("offline");
    }
  } else {
    updateSyncStatus("offline");
  }

  useWarehouse.setState({ ready: true });
  if (!isAdmin) showToast(t(lang(), "guestHint"), "info", 5000);
  else maybeWeeklyBackup();
}

export async function login(password: string) {
  const role = await loginWithPassword(password);
  if (role) {
    useWarehouse.setState({ isAdmin: role === "admin", isAuthenticated: true, role });
    showToast(t(lang(), "loginOk"), "success");
    if (role === "admin") maybeWeeklyBackup();
    return true;
  }
  showToast(t(lang(), "loginError"), "error");
  return false;
}

export function logout() {
  logoutSession();
  sessionStorage.removeItem("warehouse_role");
  useWarehouse.setState({ isAdmin: false, isAuthenticated: false, role: "viewer", tab: "dashboard", editingKey: null });
  showToast(t(lang(), "logoutOk"), "info");
}

export function setLang(next: Lang) {
  useWarehouse.setState({ lang: next });
  document.documentElement.lang = next === "ar" ? "ar" : next;
  document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  try {
    localStorage.setItem("warehouseLang", next);
  } catch {
    /* ignore */
  }
}

export function setTab(tab: TabId) {
  useWarehouse.setState({ tab });
}

export function setSearch(search: string) {
  useWarehouse.setState({ search });
}

export function setInventoryFilter(inventoryFilter: InventoryFilter) {
  useWarehouse.setState({ inventoryFilter });
}

export function setCategoryFilter(categoryFilter: string) {
  useWarehouse.setState({ categoryFilter });
}

export function setType(type: "in" | "out") {
  if (!operator()) return;
  useWarehouse.setState({ currentType: type });
}

export function setBorrowType(type: "borrow" | "return") {
  if (!operator()) return;
  useWarehouse.setState({ currentBorrowType: type });
}

export function loadMoreHistory() {
  useWarehouse.setState({ historyLimit: useWarehouse.getState().historyLimit + 50 });
}

export function loadMoreBorrow() {
  useWarehouse.setState({ borrowLimit: useWarehouse.getState().borrowLimit + 50 });
}

export function openEdit(key: string) {
  if (!admin()) return;
  useWarehouse.setState({ editingKey: key });
}

export function closeEdit() {
  useWarehouse.setState({ editingKey: null });
}

type SyncResult<T = void> = { ok: true; value: T } | { ok: false };

async function withSync<T>(fn: () => Promise<T> | T): Promise<SyncResult<T>> {
  if (isSyncing || useWarehouse.getState().submitting) {
    showToast(t(lang(), "busy"), "warning");
    return { ok: false };
  }
  isSyncing = true;
  useWarehouse.setState({ submitting: true });
  updateSyncStatus("syncing");
  let cloudResult: "ok" | "error" | "skipped" = "skipped";
  try {
    const value = await fn();
    lastLocalWriteAt = Date.now();
    saveSyncFlags();
    saveToStorage();
    pushData();
    try {
      // User-initiated ops always force sync (ignore cooldown).
      await syncToCloud(true);
      cloudResult = "ok";
    } catch {
      /* local kept — purge flag stays so the next load retries */
      cloudResult = "error";
    }
    return { ok: true, value };
  } catch (err) {
    console.error("withSync", err);
    const msg = String((err as Error)?.message || err).slice(0, 120);
    showToast(`${t(lang(), "syncError")}${msg ? `: ${msg}` : ""}`, "error", 8000);
    return { ok: false };
  } finally {
    isSyncing = false;
    useWarehouse.setState({ submitting: false });
    // Do not wipe a real sync failure with a false "online" status.
    if (cloudEnabled) {
      if (cloudResult === "ok") updateSyncStatus("online");
      else if (cloudResult === "error") updateSyncStatus("error");
    }
  }
}

export async function submitRegister(input: {
  material: string;
  quantity: string;
  employee: string;
  date: string;
}) {
  if (!operator()) {
    showToast(t(lang(), "adminOnly"), "error");
    return false;
  }
  const quantity = parseQty(input.quantity);
  const employee = input.employee.trim();
  if (!quantity || !employee || !input.material) {
    showToast(!quantity ? t(lang(), "qtyInvalid") : t(lang(), "fillFields"), "error");
    return false;
  }
  const item = inventory[input.material];
  if (!item) {
    showToast(t(lang(), "materialMissing"), "error");
    return false;
  }
  if (!isActiveMaterial(item)) {
    showToast(t(lang(), "archivedMaterial"), "error");
    return false;
  }
  const type = useWarehouse.getState().currentType;
  if (type === "out" && item.qty < quantity) {
    showToast(`${t(lang(), "notEnough")} ${item.qty}`, "error");
    return false;
  }
  const registered = await withSync(() => {
    if (type === "out") item.qty -= quantity;
    else item.qty += quantity;
    item.updatedAt = Date.now();
    appendHistory({
      id: newId(),
      ts: Date.now(),
      material: input.material,
      qty: quantity,
      employee,
      date: input.date || "",
      type,
      section: item.section || "office",
      source: "register",
      sealed: true,
    });
  });
  if (!registered.ok) return false;
  showToast(`${t(lang(), type === "out" ? "typeOut" : "typeIn")} — OK`, "success");
  return true;
}

export async function submitBorrow(input: {
  material: string;
  quantity: string;
  employee: string;
  date: string;
  note: string;
}) {
  if (!operator()) {
    showToast(t(lang(), "adminOnly"), "error");
    return false;
  }
  const quantity = parseQty(input.quantity);
  const employee = input.employee.trim();
  if (!quantity || !employee || !input.material) {
    showToast(!quantity ? t(lang(), "qtyInvalid") : t(lang(), "fillFields"), "error");
    return false;
  }
  const item = inventory[input.material];
  if (!item) {
    showToast(t(lang(), "materialMissing"), "error");
    return false;
  }
  if (!isActiveMaterial(item)) {
    showToast(t(lang(), "archivedMaterial"), "error");
    return false;
  }
  const type = useWarehouse.getState().currentBorrowType;
  if (type === "borrow" && item.qty < quantity) {
    showToast(`${t(lang(), "notEnough")} ${item.qty}`, "error");
    return false;
  }
  if (type === "return" && (item.borrowed || 0) < quantity) {
    showToast(`${t(lang(), "notEnoughBorrowed")} ${item.borrowed || 0}`, "error");
    return false;
  }
  const done = await withSync(() => {
    if (type === "borrow") {
      item.qty -= quantity;
      item.borrowed = (item.borrowed || 0) + quantity;
      item.updatedAt = Date.now();
    } else {
      item.qty += quantity;
      item.borrowed = Math.max(0, (item.borrowed || 0) - quantity);
      item.updatedAt = Date.now();
    }
    appendHistory(
      {
        id: newId(),
        ts: Date.now(),
        material: input.material,
        qty: quantity,
        employee,
        date: input.date || "",
        type,
        section: item.section || "office",
        note: input.note.trim() || (type === "borrow" ? t(lang(), "typeBorrow") : t(lang(), "typeReturn")),
        source: "borrow",
        sealed: true,
      },
      true,
    );
  });
  if (!done.ok) return false;
  showToast(t(lang(), type === "borrow" ? "borrowSuccess" : "returnSuccess"), "success");
  return true;
}

function isDuplicateMaterial(
  names: { key?: string; ar?: string; fr?: string; en?: string },
  excludeKey: string | null = null,
) {
  const candidates = [names.key, names.ar, names.fr, names.en]
    .map((name) => normalizeMaterialName(name || ""))
    .filter(Boolean);
  if (!candidates.length) return false;
  return Object.entries(inventory).some(
    ([key, item]) =>
      key !== excludeKey && materialNameTokens(key, item).some((name) => candidates.includes(name)),
  );
}

export async function addMaterial(input: {
  ar: string;
  fr: string;
  en: string;
  unit: string;
  minQty: string;
  img: string;
  section: string;
  category: string;
  status: MaterialStatus;
}) {
  if (!admin()) {
    showToast(t(lang(), "adminOnly"), "error");
    return false;
  }
  const ar = input.ar.trim();
  const fr = input.fr.trim();
  const en = input.en.trim();
  if (!ar && !fr && !en) {
    showToast(t(lang(), "enterName"), "error");
    return false;
  }
  const key = ar || fr || en;
  if (isDuplicateMaterial({ key, ar, fr, en })) {
    showToast(`${t(lang(), "duplicateName")}: ${key}`, "error");
    return false;
  }
  const minQty = Number.parseInt(input.minQty, 10);
  const now = Date.now();
  const added = await withSync(async () => {
    inventory[key] = {
      qty: 0,
      unit: input.unit.trim() || "قطعة",
      borrowed: 0,
      section: input.section.trim() || "office",
      category: input.category.trim() || input.section.trim() || "office",
      status: input.status,
      ar: ar || key,
      fr: fr || key,
      en: en || key,
      img: "",
      imgUrl: "",
      minQty: minQty > 0 ? minQty : 10,
      archived: input.status === "archived",
      updatedAt: now,
    };
    if (input.img) await persistImage(key, input.img);
  });
  if (!added.ok) return false;
  showToast(`${t(lang(), "addedOk")}: ${key}`, "success");
  return true;
}

export async function saveEdit(input: {
  key: string;
  ar: string;
  fr: string;
  en: string;
  unit: string;
  minQty: string;
  img?: string;
  section: string;
  category: string;
  status: MaterialStatus;
}) {
  if (!admin()) return false;
  const item = inventory[input.key];
  if (!item) {
    showToast(t(lang(), "materialMissing"), "error");
    return false;
  }
  if (isDuplicateMaterial({ ar: input.ar, fr: input.fr, en: input.en }, input.key)) {
    showToast(t(lang(), "duplicateName"), "error");
    return false;
  }
  const minQty = Number.parseInt(input.minQty, 10);
  const saved = await withSync(async () => {
    item.ar = input.ar.trim() || input.key;
    item.fr = input.fr.trim() || input.key;
    item.en = input.en.trim() || input.key;
    item.unit = input.unit.trim() || item.unit;
    item.section = input.section.trim() || "office";
    item.category = input.category.trim() || item.section || "office";
    item.status = input.status;
    item.archived = input.status === "archived";
    if (minQty > 0) item.minQty = minQty;
    if (input.img) await persistImage(input.key, input.img);
    item.updatedAt = Date.now();
  });
  if (!saved.ok) return false;
  useWarehouse.setState({ editingKey: null });
  showToast(t(lang(), "savedOk"), "success");
  return true;
}

export async function archiveMaterial(key: string) {
  if (!admin()) {
    showToast(t(lang(), "adminOnly"), "error");
    return false;
  }
  const item = inventory[key];
  if (!item) {
    showToast(t(lang(), "materialMissing"), "error");
    return false;
  }
  if (item.archived || item.status === "archived") {
    showToast(t(lang(), "archivedMaterial"), "warning");
    return false;
  }
  if (!window.confirm(`${t(lang(), "confirmArchive")}\n${key}`)) return false;
  const done = await withSync(() => {
    item.archived = true;
    item.status = "archived";
    item.updatedAt = Date.now();
  });
  if (!done.ok) return false;
  showToast(t(lang(), "archivedOk"), "success");
  return true;
}

export async function restoreMaterial(key: string) {
  if (!admin()) {
    showToast(t(lang(), "adminOnly"), "error");
    return false;
  }
  const item = inventory[key];
  if (!item) {
    showToast(t(lang(), "materialMissing"), "error");
    return false;
  }
  const done = await withSync(() => {
    item.archived = false;
    item.status = "active";
    item.updatedAt = Date.now();
  });
  if (!done.ok) return false;
  showToast(t(lang(), "restoredOk"), "success");
  return true;
}

export async function deleteMaterial(key: string) {
  if (!admin()) {
    showToast(t(lang(), "adminOnly"), "error");
    return false;
  }
  const item = inventory[key];
  if (!item) {
    showToast(t(lang(), "materialMissing"), "error");
    return false;
  }
  if (!item.archived && item.status !== "archived") {
    showToast(t(lang(), "archiveBeforeDelete"), "warning");
    return false;
  }
  if (!window.confirm(`${t(lang(), "confirmDeletePermanent")}\n${key}`)) return false;
  const done = await withSync(async () => {
    delete inventory[key];
    await idbDelete(key);
  });
  if (!done.ok) return false;
  showToast(`${t(lang(), "deletedOk")}: ${key}`, "success");
  return true;
}

function buildExportPayload() {
  return {
    inventory: Object.fromEntries(
      Object.entries(inventory).map(([k, v]) => {
        const { img: _ignored, ...rest } = v;
        void _ignored;
        return [k, rest];
      }),
    ),
    history,
    borrowHistory,
    exportedAt: new Date().toISOString(),
    version: "2.0",
  };
}

/** Silent local backup before import — no download, no toast. */
function saveLocalImportBackup() {
  try {
    localStorage.setItem("warehouseImportBackup", JSON.stringify(buildExportPayload()));
    localStorage.setItem("warehouseImportBackupAt", new Date().toISOString());
  } catch {
    /* best effort */
  }
}

export function exportJson(options?: { silent?: boolean }) {
  const data = buildExportPayload();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `warehouse-backup-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  try {
    localStorage.setItem("warehouseLastWeeklyBackup", String(Date.now()));
  } catch {
    /* ignore */
  }
  if (!options?.silent) showToast(t(lang(), "exportOk"), "success");
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Weekly reminder for admins — never auto-download a file. */
function maybeWeeklyBackup() {
  if (typeof window === "undefined") return;
  if (!admin()) return;
  try {
    const last = Number(localStorage.getItem("warehouseLastWeeklyBackup") || 0);
    if (last > 0 && Date.now() - last < WEEK_MS) return;
    window.setTimeout(() => {
      if (!admin()) return;
      showToast(t(lang(), "weeklyBackupHint"), "info", 8000);
    }, 2500);
  } catch {
    /* ignore */
  }
}

async function uploadImportedImages(images: Record<string, string>) {
  if (!Object.keys(images).length) return;
  try {
    await Promise.all(
      Object.entries(images).map(async ([key, dataUrl]) => {
        const compressed = await compressDataUrl(dataUrl);
        const cloudImage = await uploadImageWithRetry(key, compressed);
        if (!inventory[key]) return;
        inventory[key].imgData = cloudImage;
        inventory[key].imgUrl = "";
        inventory[key].img = cloudImage;
        inventory[key].updatedAt = Date.now();
        await idbSet(key, compressed).catch((err) => console.warn("idb import cache", err));
      }),
    );
    saveToStorage();
    pushData();
    await syncToCloud(true);
  } catch (error) {
    console.error("Imported image cloud upload failed:", error);
    showToast("فشل رفع صورة أو أكثر إلى التخزين السحابي؛ لم تُعتبر الصور محفوظة.", "error", 8000);
    throw error;
  }
}

export async function importJsonFile(file: File) {
  if (!admin()) {
    showToast(t(lang(), "adminOnly"), "error");
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text) as {
      inventory?: Record<string, Partial<Material>>;
      history?: HistoryEntry[];
      borrowHistory?: HistoryEntry[];
    };
    if (!data.inventory || typeof data.inventory !== "object" || Array.isArray(data.inventory)) {
      throw new Error(t(lang(), "emptyFile"));
    }
    const next: Record<string, Material> = {};
    let added = 0;
    let updated = 0;
    let invalid = 0;
    const importedImages: Record<string, string> = {};
    const seenNames = new Set<string>();
    for (const [rawKey, value] of Object.entries(data.inventory)) {
      const key = String(rawKey).trim();
      const qtyParsed = parseOptionalNonNegInt(value?.qty);
      const borrowedParsed = parseOptionalNonNegInt(value?.borrowed);
      if (
        !key ||
        !value ||
        typeof value !== "object" ||
        qtyParsed.kind !== "ok" ||
        (borrowedParsed.kind !== "ok" && borrowedParsed.kind !== "blank")
      ) {
        invalid += 1;
        continue;
      }
      const borrowed = borrowedParsed.kind === "ok" ? borrowedParsed.value : 0;
      const mat = normalizeMaterial({ ...value, qty: qtyParsed.value, borrowed }, key);
      const tokens = materialNameTokens(key, mat);
      if (tokens.some((name) => seenNames.has(name))) {
        invalid += 1;
        continue;
      }
      tokens.forEach((name) => seenNames.add(name));
      const existingKey = Object.keys(inventory).find((candidate) =>
        materialNameTokens(candidate, inventory[candidate]).some((name) => tokens.includes(name)),
      );
      const targetKey = existingKey || key;
      const prev = existingKey ? inventory[existingKey] : undefined;
      const rawImage = typeof value.img === "string" && value.img.startsWith("data:") ? value.img : "";
      if (rawImage) importedImages[targetKey] = rawImage;
      if (rawImage) mat.img = rawImage;
      if (!rawImage && prev?.img) mat.img = prev.img;
      mat.updatedAt = Math.max(Number(mat.updatedAt) || 0, Date.now());
      next[targetKey] = mat;
      if (prev) updated += 1;
      else added += 1;
    }
    const removed = Object.keys(inventory).filter((k) => !next[k]).length;
    const preview = `${t(lang(), "importPreviewTitle")}\n${t(lang(), "importNew")}: ${added}\n${t(lang(), "importUpdated")}: ${updated}\n${t(lang(), "importRemoved")}: ${removed}\n${t(lang(), "importInvalid")}: ${invalid}`;
    if (invalid > 0) {
      showToast(`${preview}\n${t(lang(), "importBlocked")}`, "error", 7000);
      return;
    }
    const confirmText =
      removed > 0
        ? `${preview}\n\n${t(lang(), "importWillDelete")}\n\n${t(lang(), "importConfirm")}`
        : `${preview}\n\n${t(lang(), "importConfirm")}`;
    if (!window.confirm(confirmText)) return;
    saveLocalImportBackup();
    pending.materials = null;
    pending.history = null;
    pending.borrow = null;
    purgeCloudExtras = true;
    lastLocalWriteAt = Date.now();
    saveSyncFlags();
    const imported = await withSync(async () => {
      inventory = dedupeMaterialsByName(next);
      // Immutable log: import only appends missing operation ids — never replaces.
      if (data.history) {
        history = mergeAppendOnly(
          history,
          normalizeEntries(data.history).map((e) => ({ ...e, source: e.source || "import", sealed: true })),
        );
      }
      if (data.borrowHistory) {
        borrowHistory = mergeAppendOnly(
          borrowHistory,
          normalizeEntries(data.borrowHistory).map((e) => ({
            ...e,
            source: e.source || "import",
            sealed: true,
          })),
        );
      }
      await Promise.all(
        Object.entries(importedImages).map(([key, dataUrl]) =>
          idbSet(key, dataUrl).catch((err) => console.warn("idb import set", err)),
        ),
      );
    });
    if (!imported.ok) return;
    // Discard any snapshot queued before the import. The next snapshot will
    // contain the newly imported records after syncToCloud completes.
    pending.materials = null;
    pending.history = null;
    pending.borrow = null;
    saveToStorage();
    pushData();
    if (Object.keys(importedImages).length) {
      await uploadImportedImages(importedImages);
    }
    showToast(t(lang(), "importOk"), "success");
  } catch (err) {
    showToast(`${t(lang(), "jsonError")}: ${(err as Error).message}`, "error");
  }
}

export async function exportExcel() {
  try {
    showToast(t(lang(), "syncSyncing"), "info", 1600);
    const XLSX = await loadSheetJS();
    const rows = Object.keys(inventory).map((key) => {
      const it = inventory[key];
      return {
        بالعربية: it.ar || "",
        بالفرنسية: it.fr || "",
        بالإنجليزية: it.en || "",
        الوحدة: it.unit || "",
        الكمية: it.qty || 0,
        المستعار: it.borrowed || 0,
        "القسم/Section": it.section || "office",
        "آخر تحديث/UpdatedAt": it.updatedAt || 0,
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "المواد");
    XLSX.writeFile(wb, `warehouse-materials-${new Date().toISOString().split("T")[0]}.xlsx`);
    showToast(t(lang(), "excelExportOk"), "success");
  } catch (err) {
    showToast(`${t(lang(), "excelError")}: ${(err as Error).message}`, "error");
  }
}

export async function importExcelFile(file: File) {
  if (!admin()) {
    showToast(t(lang(), "adminOnly"), "error");
    return;
  }
  try {
    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0] ?? ""];
    if (!sheet) {
      showToast(t(lang(), "emptyFile"), "error");
      return;
    }
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (!rows.length) {
      showToast(t(lang(), "emptyFile"), "error");
      return;
    }
    const staged: Array<{ key: string; material: Material; existingKey: string | null }> = [];
    let added = 0;
    let updated = 0;
    let invalid = 0;
    const seenNames = new Set<string>();
    for (const rawRow of rows) {
      const row = rawRow as Record<string, unknown>;
      const ar = String(row["بالعربية"] ?? row.ar ?? "").trim();
      const fr = String(row["بالفرنسية"] ?? row.fr ?? "").trim();
      const en = String(row["بالإنجليزية"] ?? row.en ?? "").trim();
      const unit = String(row["الوحدة"] ?? row.unit ?? "قطعة").trim() || "قطعة";
      const key = ar || fr || en;
      const section = String(row["القسم/Section"] ?? row.section ?? "office").trim() || "office";
      const existingKey = Object.keys(inventory).find((candidate) =>
        materialNameTokens(candidate, inventory[candidate]).some((name) => [key, ar, fr, en].map(normalizeMaterialName).filter(Boolean).includes(name)),
      ) || null;
      const prev = existingKey ? inventory[existingKey] : undefined;
      const status: MaterialStatus = prev?.status || (prev?.archived ? "archived" : "active");
      const qtyParsed = parseOptionalNonNegInt(row["الكمية"] ?? row.qty);
      const borrowedParsed = parseOptionalNonNegInt(row["المستعار"] ?? row.borrowed);
      if (!key || qtyParsed.kind === "bad" || borrowedParsed.kind === "bad") {
        invalid += 1;
        continue;
      }
      // Blank qty on a new row is invalid; on an existing row keep the current stock.
      if (qtyParsed.kind === "blank" && !prev) {
        invalid += 1;
        continue;
      }
      const qtyRaw = qtyParsed.kind === "ok" ? qtyParsed.value : Number(prev?.qty) || 0;
      const borrowedRaw =
        borrowedParsed.kind === "ok" ? borrowedParsed.value : Number(prev?.borrowed) || 0;
      const tokens = [key, ar, fr, en].map(normalizeMaterialName).filter(Boolean);
      if (tokens.some((name) => seenNames.has(name))) {
        invalid += 1;
        continue;
      }
      tokens.forEach((name) => seenNames.add(name));
      const material: Material = {
        qty: qtyRaw,
        unit,
        borrowed: borrowedRaw,
        section,
        category: section,
        status,
        ar: ar || key,
        fr: fr || key,
        en: en || key,
        img: prev?.img || "",
        imgUrl: prev?.imgUrl || "",
        minQty: prev?.minQty || 10,
        archived: prev?.archived || false,
        updatedAt: Date.now(),
      };
      staged.push({ key, material, existingKey });
      if (existingKey) updated += 1;
      else added += 1;
    }
    const preview = `${t(lang(), "importPreviewTitle")}\n${t(lang(), "importNew")}: ${added}\n${t(lang(), "importUpdated")}: ${updated}\n${t(lang(), "importInvalid")}: ${invalid}`;
    if (invalid > 0) {
      showToast(`${preview}\n${t(lang(), "importBlocked")}`, "error", 7000);
      return;
    }
    if (!window.confirm(`${preview}\n\n${t(lang(), "importConfirm")}`)) return;
    saveLocalImportBackup();
    // Drop any queued cloud snapshot so a stale Firebase view cannot wipe
    // the freshly imported rows before syncToCloud finishes.
    pending.materials = null;
    pending.history = null;
    pending.borrow = null;
    const imported = await withSync(() => {
      for (const entry of staged) {
        inventory[entry.existingKey || entry.key] = entry.material;
      }
    });
    if (!imported.ok) return;
    pending.materials = null;
    pending.history = null;
    pending.borrow = null;
    saveToStorage();
    pushData();
    showToast(`${t(lang(), "importOk")}: +${added} / ~${updated}`, "success");
  } catch (err) {
    showToast(`${t(lang(), "excelError")}: ${(err as Error).message}`, "error");
  }
}

/**
 * Commit a stock count session.
 * `actuals` maps material key → counted quantity (only keys the user filled).
 * Differences update inventory and append in/out history entries with a count note.
 */
export async function commitInventoryCount(
  actuals: Record<string, number>,
  employee: string,
): Promise<{ adjusted: number; matched: number } | null> {
  if (!admin() && useWarehouse.getState().role !== "operator") {
    showToast(t(lang(), "adminOnly"), "error");
    return null;
  }
  const emp = employee.trim();
  if (!emp) {
    showToast(t(lang(), "countNeedEmployee"), "error");
    return null;
  }
  const entries = Object.entries(actuals).filter(([, qty]) => Number.isInteger(qty) && qty >= 0);
  if (!entries.length) {
    showToast(t(lang(), "countFillSome"), "error");
    return null;
  }

  let adjusted = 0;
  let matched = 0;
  const date = todayISO();
  const ops: Array<{ key: string; type: "in" | "out"; qty: number; note: string }> = [];

  for (const [key, actual] of entries) {
    const item = inventory[key];
    if (!item || !isActiveMaterial(item)) continue;
    const system = Number(item.qty) || 0;
    const borrowed = Math.max(0, Number(item.borrowed) || 0);
    // Actual on-hand count cannot be below currently borrowed quantity.
    if (actual < borrowed) {
      showToast(`${t(lang(), "countBelowBorrowed")}: ${key} (≥ ${borrowed})`, "error", 6000);
      return null;
    }
    if (actual === system) {
      matched += 1;
      continue;
    }
    const diff = actual - system;
    ops.push({
      key,
      type: diff > 0 ? "in" : "out",
      qty: Math.abs(diff),
      note: diff > 0 ? t(lang(), "countNoteSurplus") : t(lang(), "countNoteShortage"),
    });
  }

  if (!ops.length) {
    showToast(t(lang(), "countNoDiffs"), "info");
    return { adjusted: 0, matched };
  }

  if (!window.confirm(t(lang(), "countConfirm"))) return null;

  const counted = await withSync(() => {
    for (const op of ops) {
      const item = inventory[op.key];
      if (!item) continue;
      const borrowed = Math.max(0, Number(item.borrowed) || 0);
      if (op.type === "in") item.qty += op.qty;
      else item.qty = Math.max(borrowed, item.qty - op.qty);
      item.updatedAt = Date.now();
      appendHistory({
        id: newId(),
        ts: Date.now(),
        material: op.key,
        qty: op.qty,
        employee: emp,
        date,
        type: op.type,
        section: item.section || "office",
        note: op.note,
        source: "count",
        sealed: true,
      });
      adjusted += 1;
    }
  });
  if (!counted.ok) return null;

  showToast(`${t(lang(), "countOk")} · ${adjusted}`, "success");
  return { adjusted, matched };
}

export function destroyWarehouse() {
  unsubs.forEach((u) => u());
  unsubs = [];
  if (idleHandle != null) cancelIdle(idleHandle);
  idleHandle = null;
}
