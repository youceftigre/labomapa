import { create } from "zustand";
import type {
  HistoryEntry,
  InventoryFilter,
  Lang,
  Material,
  OpType,
  SyncMetadata,
  SyncStatus,
  TabId,
  Toast,
  UserRole,
} from "./types";

export type WarehouseState = {
  ready: boolean;
  isAuthenticated: boolean;
  lang: Lang;
  isAdmin: boolean;
  role: UserRole;
  inventory: Record<string, Material>;
  history: HistoryEntry[];
  borrowHistory: HistoryEntry[];
  syncStatus: SyncStatus;
  syncMetadata: SyncMetadata;
  search: string;
  inventoryFilter: InventoryFilter;
  categoryFilter: string;
  tab: TabId;
  historyLimit: number;
  borrowLimit: number;
  toasts: Toast[];
  submitting: boolean;
  currentType: Extract<OpType, "in" | "out">;
  currentBorrowType: Extract<OpType, "borrow" | "return">;
  editingKey: string | null;
};

export const useWarehouse = create<WarehouseState>(() => ({
  ready: false,
  isAuthenticated: false,
  lang: "ar",
  isAdmin: false,
  role: "viewer",
  inventory: {},
  history: [],
  borrowHistory: [],
  syncStatus: "syncing",
  syncMetadata: {
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastCloudAppliedAt: 0,
    lastErrorAt: 0,
  },
  search: "",
  inventoryFilter: "all",
  categoryFilter: "",
  tab: "dashboard",
  historyLimit: 50,
  borrowLimit: 50,
  toasts: [],
  submitting: false,
  currentType: "out",
  currentBorrowType: "borrow",
  editingKey: null,
}));
