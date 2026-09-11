export type Lang = "ar" | "fr" | "en";
export type TabId =
  | "dashboard"
  | "register"
  | "inventory"
  | "borrow"
  | "history"
  | "manage"
  | "count";
export type OpType = "in" | "out" | "borrow" | "return";
export type SyncStatus = "syncing" | "online" | "offline" | "error";
export type ToastType = "success" | "error" | "warning" | "info";
export type UserRole = "viewer" | "operator" | "admin";
export type MaterialStatus = "active" | "inactive" | "archived";
export type InventoryFilter = "all" | "low" | "out" | "category";

export type SyncMetadata = {
  lastAttemptAt: number;
  lastSuccessAt: number;
  lastCloudAppliedAt: number;
  lastErrorAt: number;
};

export type Material = {
  qty: number;
  unit: string;
  borrowed: number;
  section: string;
  category: string;
  status: MaterialStatus;
  ar: string;
  fr: string;
  en: string;
  img: string;
  /** Compressed data URL persisted in Firestore for Spark-compatible image storage. */
  imgData?: string;
  imgUrl: string;
  minQty: number;
  archived?: boolean;
  updatedAt?: number;
};

/** Source of an operation — for audit / immutable log. */
export type HistorySource = "register" | "borrow" | "count" | "import" | "migration" | "system";

/**
 * Immutable operation log entry.
 * Once created, entries must never be updated or deleted (append-only log).
 */
export type HistoryEntry = {
  id: string;
  ts: number;
  material: string;
  qty: number;
  employee: string;
  date: string;
  type: OpType;
  section: string;
  note?: string;
  /** Origin of the entry (optional for legacy rows). */
  source?: HistorySource;
  /** Always true for new entries — marks sealed immutable records. */
  sealed?: boolean;
};

export type Toast = {
  id: string;
  message: string;
  type: ToastType;
};
