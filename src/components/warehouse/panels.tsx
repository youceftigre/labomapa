"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Camera, FileSpreadsheet, ImagePlus, Pencil, Plus, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import {
  addMaterial,
  archiveMaterial,
  commitInventoryCount,
  deleteMaterial,
  exportExcel,
  importExcelFile,
  loadMoreBorrow,
  loadMoreHistory,
  openEdit,
  restoreMaterial,
  setBorrowType,
  setType,
  showToast,
  submitBorrow,
  submitRegister,
} from "@/lib/warehouse/engine";
import { compressImage } from "@/lib/warehouse/images";
import { t } from "@/lib/warehouse/i18n";
import { entryTs, firstActiveKey, getName, isActiveMaterial, matchesSearch, todayISO, typeLabel } from "@/lib/warehouse/helpers";
import { useWarehouse } from "@/lib/warehouse/state";
import type { HistoryEntry } from "@/lib/warehouse/types";
import { Thumb } from "./dashboard";

export function RegisterPanel() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const currentType = useWarehouse((s) => s.currentType);
  const submitting = useWarehouse((s) => s.submitting);
  const keys = Object.keys(inventory);
  const [material, setMaterial] = useState(() => firstActiveKey(inventory));
  const [quantity, setQuantity] = useState("");
  const [employee, setEmployee] = useState("");
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    const active = firstActiveKey(inventory);
    if (!material || !inventory[material] || !isActiveMaterial(inventory[material])) {
      if (active) setMaterial(active);
    }
  }, [inventory, keys, material]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await submitRegister({ material, quantity, employee, date });
    if (ok) {
      setQuantity("");
      setEmployee("");
    }
  }

  return (
    <div className="card mx-auto w-full max-w-lg min-w-0">
      <h2 className="mb-4 text-center text-lg font-bold text-navy">{t(lang, "quickReg")}</h2>
      <form className="grid min-w-0 gap-3" onSubmit={onSubmit}>
        <MaterialSelect value={material} onChange={setMaterial} />
        <div className="field">
          <label>{t(lang, "quantity")}</label>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{t(lang, "type")}</label>
          <div className="grid grid-cols-2 gap-2">
            <TypeBtn active={currentType === "out"} tone="out" onClick={() => setType("out")}>
              {t(lang, "btnOut")}
            </TypeBtn>
            <TypeBtn active={currentType === "in"} tone="in" onClick={() => setType("in")}>
              {t(lang, "btnIn")}
            </TypeBtn>
          </div>
        </div>
        <div className="field">
          <label>{t(lang, "employee")}</label>
          <input required value={employee} onChange={(e) => setEmployee(e.target.value)} />
        </div>
        <div className="field">
          <label>{t(lang, "date")}</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button type="submit" className="primary-btn" disabled={submitting}>
          {t(lang, "btnSubmit")}
        </button>
      </form>
    </div>
  );
}

export function BorrowPanel() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const currentBorrowType = useWarehouse((s) => s.currentBorrowType);
  const submitting = useWarehouse((s) => s.submitting);
  const borrowHistory = useWarehouse((s) => s.borrowHistory);
  const borrowLimit = useWarehouse((s) => s.borrowLimit);
  const keys = Object.keys(inventory);
  const [material, setMaterial] = useState(() => firstActiveKey(inventory));
  const [quantity, setQuantity] = useState("");
  const [employee, setEmployee] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    const active = firstActiveKey(inventory);
    if (!material || !inventory[material] || !isActiveMaterial(inventory[material])) {
      if (active) setMaterial(active);
    }
  }, [inventory, keys, material]);

  const shown = useMemo(
    () => [...borrowHistory].sort((a, b) => entryTs(b) - entryTs(a)).slice(0, borrowLimit),
    [borrowHistory, borrowLimit],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await submitBorrow({ material, quantity, employee, date, note });
    if (ok) {
      setQuantity("");
      setEmployee("");
      setNote("");
    }
  }

  return (
    <>
      <div className="card mx-auto w-full max-w-lg min-w-0">
        <h2 className="mb-4 text-center text-lg font-bold text-navy">{t(lang, "borrowTitle")}</h2>
        <form className="grid min-w-0 gap-3" onSubmit={onSubmit}>
          <MaterialSelect value={material} onChange={setMaterial} />
          <div className="field">
            <label>{t(lang, "borrowType")}</label>
            <div className="grid grid-cols-2 gap-2">
              <TypeBtn active={currentBorrowType === "borrow"} tone="borrow" onClick={() => setBorrowType("borrow")}>
                {t(lang, "btnBorrow")}
              </TypeBtn>
              <TypeBtn active={currentBorrowType === "return"} tone="return" onClick={() => setBorrowType("return")}>
                {t(lang, "btnReturn")}
              </TypeBtn>
            </div>
          </div>
          <div className="field">
            <label>{t(lang, "quantity")}</label>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <div className="field">
            <label>{t(lang, "employee")}</label>
            <input required value={employee} onChange={(e) => setEmployee(e.target.value)} />
          </div>
          <div className="field">
            <label>{t(lang, "borrowNote")}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <label>{t(lang, "date")}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="submit" className="primary-btn" disabled={submitting}>
            {t(lang, currentBorrowType === "borrow" ? "btnBorrowSubmit" : "btnReturnSubmit")}
          </button>
        </form>
      </div>
      <div className="card">
        <h2 className="mb-3 text-lg font-bold text-navy">{t(lang, "borrowHistory")}</h2>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-muted">{t(lang, "noBorrowHistory")}</p>
        ) : (
          <HistoryList items={shown} />
        )}
        {borrowHistory.length > shown.length ? (
          <button type="button" className="primary-btn" onClick={loadMoreBorrow}>
            {t(lang, "loadMore")} ({shown.length} {t(lang, "of")} {borrowHistory.length})
          </button>
        ) : null}
      </div>
    </>
  );
}

export function HistoryPanel() {
  const lang = useWarehouse((s) => s.lang);
  const history = useWarehouse((s) => s.history);
  const historyLimit = useWarehouse((s) => s.historyLimit);

  const stats = useMemo(() => {
    const map: Record<string, { out: number; in: number; borrow: number; ret: number }> = {};
    for (const entry of history) {
      const name = entry.employee || "-";
      if (!map[name]) map[name] = { out: 0, in: 0, borrow: 0, ret: 0 };
      if (entry.type === "out") map[name].out += 1;
      else if (entry.type === "in") map[name].in += 1;
      else if (entry.type === "borrow") map[name].borrow += 1;
      else if (entry.type === "return") map[name].ret += 1;
    }
    return Object.entries(map).sort(
      (a, b) =>
        b[1].out + b[1].in + b[1].borrow + b[1].ret - (a[1].out + a[1].in + a[1].borrow + a[1].ret),
    );
  }, [history]);

  const shown = useMemo(
    () => [...history].sort((a, b) => entryTs(b) - entryTs(a)).slice(0, historyLimit),
    [history, historyLimit],
  );

  return (
    <>
      <div className="card">
        <h2 className="mb-3 text-lg font-bold text-navy">{t(lang, "empStatsTitle")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-line text-center">
                <th className="p-2 text-start">{t(lang, "thEmployee")}</th>
                <th className="p-2">{t(lang, "thOutCount")}</th>
                <th className="p-2">{t(lang, "thInCount")}</th>
                <th className="p-2">{t(lang, "thBorrowCount")}</th>
                <th className="p-2">{t(lang, "thReturnCount")}</th>
                <th className="p-2">{t(lang, "thTotalOps")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted">
                    {t(lang, "noEmpStats")}
                  </td>
                </tr>
              ) : (
                stats.map(([name, s]) => (
                  <tr key={name} className="border-b border-line">
                    <td className="p-2 text-start font-semibold">{name}</td>
                    <td className="p-2 text-center tabular-nums text-bad">{s.out}</td>
                    <td className="p-2 text-center tabular-nums text-ok">{s.in}</td>
                    <td className="p-2 text-center tabular-nums text-warn">{s.borrow}</td>
                    <td className="p-2 text-center tabular-nums text-cyan-dark">{s.ret}</td>
                    <td className="p-2 text-center font-bold tabular-nums">
                      {s.out + s.in + s.borrow + s.ret}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2 className="mb-3 text-lg font-bold text-navy">{t(lang, "historyTitle")}</h2>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-muted">{t(lang, "noHistory")}</p>
        ) : (
          <HistoryList items={shown} />
        )}
        {history.length > shown.length ? (
          <button type="button" className="primary-btn" onClick={loadMoreHistory}>
            {t(lang, "loadMore")} ({shown.length} {t(lang, "of")} {history.length})
          </button>
        ) : null}
      </div>
    </>
  );
}

export function CountPanel() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const search = useWarehouse((s) => s.search);
  const submitting = useWarehouse((s) => s.submitting);
  const [employee, setEmployee] = useState("");
  const [actuals, setActuals] = useState<Record<string, string>>({});

  const items = useMemo(() => {
    return Object.entries(inventory)
      .filter(([key, item]) => isActiveMaterial(item) && matchesSearch(key, item, search))
      .sort(([a], [b]) => a.localeCompare(b, lang === "ar" ? "ar" : "en"));
  }, [inventory, search, lang]);

  const stats = useMemo(() => {
    let entered = 0;
    let matched = 0;
    let surplus = 0;
    let shortage = 0;
    for (const [key, item] of items) {
      const raw = actuals[key];
      if (raw === undefined || raw.trim() === "") continue;
      const n = Number.parseInt(raw, 10);
      if (!Number.isInteger(n) || n < 0) continue;
      entered += 1;
      const system = Number(item.qty) || 0;
      if (n === system) matched += 1;
      else if (n > system) surplus += 1;
      else shortage += 1;
    }
    return { entered, matched, surplus, shortage, total: items.length };
  }, [items, actuals]);

  function setActual(key: string, value: string) {
    setActuals((prev) => ({ ...prev, [key]: value }));
  }

  async function onCommit() {
    const payload: Record<string, number> = {};
    for (const [key, raw] of Object.entries(actuals)) {
      if (raw.trim() === "") continue;
      const n = Number.parseInt(raw, 10);
      if (Number.isInteger(n) && n >= 0) payload[key] = n;
    }
    const result = await commitInventoryCount(payload, employee);
    if (result) {
      setActuals({});
    }
  }

  return (
    <section className="rounded-xl border border-line bg-paper p-4 shadow-sm">
      <h2 className="text-lg font-bold text-navy">{t(lang, "countTitle")}</h2>
      <p className="mt-1 text-sm text-muted">{t(lang, "countHint")}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-navy/5 px-3 py-2 text-center text-sm">
          <div className="font-bold text-navy">
            {stats.entered} {t(lang, "countOf")} {stats.total}
          </div>
          <div className="text-xs text-muted">{t(lang, "countProgress")}</div>
        </div>
        <div className="rounded-md bg-ok/10 px-3 py-2 text-center text-sm">
          <div className="font-bold text-ok">{stats.matched}</div>
          <div className="text-xs text-muted">{t(lang, "countMatch")}</div>
        </div>
        <div className="rounded-md bg-cyan/10 px-3 py-2 text-center text-sm">
          <div className="font-bold text-cyan-dark">{stats.surplus}</div>
          <div className="text-xs text-muted">{t(lang, "countSurplus")}</div>
        </div>
        <div className="rounded-md bg-bad/10 px-3 py-2 text-center text-sm">
          <div className="font-bold text-bad">{stats.shortage}</div>
          <div className="text-xs text-muted">{t(lang, "countShortage")}</div>
        </div>
      </div>

      <label className="mt-4 block text-sm font-medium">
        {t(lang, "countEmployee")}
        <input
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none focus:border-cyan"
          autoComplete="name"
        />
      </label>

      <div className="mt-4 grid max-h-[480px] gap-2 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t(lang, "noResults")}</p>
        ) : (
          items.map(([key, item]) => {
            const system = Number(item.qty) || 0;
            const raw = actuals[key] ?? "";
            const n = raw.trim() === "" ? null : Number.parseInt(raw, 10);
            const valid = n !== null && Number.isInteger(n) && n >= 0;
            const diff = valid ? n - system : 0;
            return (
              <div
                key={key}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-white p-3"
              >
                <Thumb src={item.img || item.imgUrl} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-navy">{getName(item, key, lang)}</div>
                  <div className="text-xs text-muted">
                    {t(lang, "countSystemQty")}: <span className="font-bold text-ink">{system}</span> {item.unit}
                  </div>
                </div>
                <div className="w-28">
                  <label className="text-[10px] font-bold uppercase text-muted">{t(lang, "countActualQty")}</label>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={raw}
                    onChange={(e) => setActual(key, e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm outline-none focus:border-cyan"
                  />
                </div>
                {valid ? (
                  <div
                    className={`w-16 text-center text-xs font-bold ${
                      diff === 0 ? "text-ok" : diff > 0 ? "text-cyan-dark" : "text-bad"
                    }`}
                  >
                    {diff === 0 ? "=" : diff > 0 ? `+${diff}` : `${diff}`}
                  </div>
                ) : (
                  <div className="w-16 text-center text-xs text-muted">—</div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="primary-btn" disabled={submitting} onClick={() => void onCommit()}>
          {t(lang, "countCommit")}
        </button>
        <button
          type="button"
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-navy hover:bg-navy/5"
          onClick={() => setActuals({})}
        >
          {t(lang, "countReset")}
        </button>
      </div>
    </section>
  );
}

export function ManagePanel() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const search = useWarehouse((s) => s.search);
  const submitting = useWarehouse((s) => s.submitting);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ar, setAr] = useState("");
  const [fr, setFr] = useState("");
  const [en, setEn] = useState("");
  const [unit, setUnit] = useState("");
  const [minQty, setMinQty] = useState("10");
  const [img, setImg] = useState("");
  const [section, setSection] = useState("office");

  const entries = Object.entries(inventory)
    .filter(([key, item]) => matchesSearch(key, item, search))
    .sort((a, b) => {
      const aArchived = a[1].archived === true || a[1].status === "archived" ? 1 : 0;
      const bArchived = b[1].archived === true || b[1].status === "archived" ? 1 : 0;
      if (aArchived !== bArchived) return aArchived - bArchived;
      return a[0].localeCompare(b[0], lang === "ar" ? "ar" : "en");
    });

  async function onPick(file: File | undefined) {
    if (!file) return;
    try {
      setImg(await compressImage(file));
    } catch (err) {
      const code = String((err as Error).message);
      showToast(t(lang, code === "image-size" ? "imageTooLarge" : "imageInvalid"), "error");
    }
  }

  async function onAdd() {
    const ok = await addMaterial({ ar, fr, en, unit, minQty, img, section, category: section, status: "active" });
    if (ok) {
      setAr("");
      setFr("");
      setEn("");
      setUnit("");
      setMinQty("10");
      setImg("");
      setSection("office");
    }
  }

  return (
    <div className="card">
      <h2 className="mb-3 text-lg font-bold text-navy">{t(lang, "manageTitle")}</h2>
      <div className="mb-4 rounded-lg border-2 border-dashed border-navy/30 bg-paper/50 p-4">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-navy">
          <Plus className="size-4" /> {t(lang, "addOffice")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label>{t(lang, "nameAr")}</label>
            <input value={ar} onChange={(e) => setAr(e.target.value)} />
          </div>
          <div className="field">
            <label>{t(lang, "nameFr")}</label>
            <input value={fr} onChange={(e) => setFr(e.target.value)} />
          </div>
          <div className="field">
            <label>{t(lang, "nameEn")}</label>
            <input value={en} onChange={(e) => setEn(e.target.value)} />
          </div>
          <div className="field">
            <label>{t(lang, "unit")}</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="قطعة" />
          </div>
          <div className="field">
            <label>{t(lang, "minQty")}</label>
            <input type="number" min={1} value={minQty} onChange={(e) => setMinQty(e.target.value)} />
          </div>
          <div className="field">
            <label>{t(lang, "section")}</label>
            <input value={section} onChange={(e) => setSection(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="chip !bg-navy !text-paper">
            <ImagePlus className="size-3.5" /> {t(lang, "chooseImg")}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onPick(e.target.files?.[0])} />
          </label>
          <label className="chip !bg-navy-deep !text-paper">
            <Camera className="size-3.5" /> {t(lang, "captureImg")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(e) => void onPick(e.target.files?.[0])}
            />
          </label>
          {img ? <img src={img} alt="" className="size-16 rounded-md border border-line object-cover" /> : null}
        </div>
        <p className="mt-2 text-xs text-muted">{t(lang, "imagesHint")}</p>
        <button type="button" className="primary-btn max-w-xs" disabled={submitting} onClick={() => void onAdd()}>
          {t(lang, "btnAdd")}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-navy">{t(lang, "listOffice")}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-navy px-3 py-1.5 text-xs text-paper"
            onClick={() => void exportExcel()}
          >
            <FileSpreadsheet className="size-3.5" /> {t(lang, "exportExcel")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md bg-navy px-3 py-1.5 text-xs text-paper"
            onClick={() => fileRef.current?.click()}
          >
            <FileSpreadsheet className="size-3.5" /> {t(lang, "importExcel")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importExcelFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="grid gap-2">
        {entries.map(([key, item]) => {
          const archived = item.archived === true || item.status === "archived";
          return (
          <div
            key={key}
            className={`grid grid-cols-[40px_1fr_auto] items-center gap-2 rounded-md border p-2 sm:grid-cols-[48px_1fr_1fr_80px_auto] ${
              archived ? "border-warn/40 bg-amber-50/70 opacity-90" : "border-line bg-paper/40"
            }`}
          >
            <Thumb src={item.img || item.imgUrl} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{item.ar || key}</div>
              <div className="truncate text-xs text-muted">
                {item.fr} · {item.en}
              </div>
              {archived ? (
                <span className="mt-1 inline-block rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-bold text-warn">
                  {t(lang, "archivedBadge")}
                </span>
              ) : null}
            </div>
            <div className="hidden text-xs text-muted sm:block">{item.unit}</div>
            <div className="hidden text-xs tabular-nums sm:block">
              {item.qty} / {t(lang, "minQty")} {item.minQty}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className="min-h-9 min-w-9 rounded-md bg-navy px-2 py-1 text-xs text-paper"
                onClick={() => openEdit(key)}
                aria-label={t(lang, "btnEdit")}
                title={t(lang, "btnEdit")}
              >
                <Pencil className="size-3.5" />
              </button>
              {archived ? (
                <>
                  <button
                    type="button"
                    className="min-h-9 min-w-9 rounded-md bg-ok px-2 py-1 text-xs text-white"
                    onClick={() => void restoreMaterial(key)}
                    aria-label={t(lang, "btnRestore")}
                    title={t(lang, "btnRestore")}
                  >
                    <ArchiveRestore className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="min-h-9 min-w-9 rounded-md bg-bad px-2 py-1 text-xs text-white"
                    onClick={() => void deleteMaterial(key)}
                    aria-label={t(lang, "btnDelete")}
                    title={t(lang, "btnDelete")}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="min-h-9 min-w-9 rounded-md bg-warn px-2 py-1 text-xs text-white"
                  onClick={() => void archiveMaterial(key)}
                  aria-label={t(lang, "btnArchive")}
                  title={t(lang, "btnArchive")}
                >
                  <Archive className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function MaterialSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  return (
    <div className="field min-w-0">
      <label>{t(lang, "material")}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        {Object.entries(inventory).filter(([, item]) => isActiveMaterial(item)).map(([key, item]) => (
          <option key={key} value={key}>
            {getName(item, key, lang)}
          </option>
        ))}
      </select>
    </div>
  );
}

function TypeBtn({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  tone: "in" | "out" | "borrow" | "return";
  onClick: () => void;
  children: ReactNode;
}) {
  const activeClass =
    tone === "out"
      ? "border-bad bg-paper text-bad"
      : tone === "in"
        ? "border-ok bg-paper text-ok"
        : tone === "borrow"
          ? "border-warn bg-paper text-warn"
          : "border-cyan bg-paper text-cyan-dark";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border-2 px-3 py-2 text-sm ${active ? `${activeClass} font-bold` : "border-line bg-white text-ink"}`}
    >
      {children}
    </button>
  );
}

function HistoryList({ items }: { items: HistoryEntry[] }) {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  return (
    <div className="grid max-h-[420px] gap-2 overflow-y-auto">
      {items.map((entry) => {
        const tone =
          entry.type === "in"
            ? "border-s-ok bg-paper"
            : entry.type === "borrow"
              ? "border-s-warn bg-paper"
              : entry.type === "return"
                ? "border-s-cyan bg-paper"
                : "border-s-bad bg-paper";
        const item = inventory[entry.material];
        const name = item ? getName(item, entry.material, lang) : entry.material;
        const color =
          entry.type === "in"
            ? "var(--color-ok)"
            : entry.type === "borrow"
              ? "var(--color-warn)"
              : entry.type === "return"
                ? "var(--color-cyan)"
                : "var(--color-bad)";
        return (
          <div key={entry.id} className={`grid grid-cols-2 gap-2 rounded-md border-s-4 p-3 text-sm ${tone}`}>
            <div>
              <div className="text-[10px] font-bold text-cyan-dark">Office</div>
              <div className="font-bold">{name}</div>
              <div className="text-xs text-muted">
                {entry.employee}
                {entry.note ? ` · ${entry.note}` : ""}
              </div>
            </div>
            <div className="text-end">
              <div className="font-bold" style={{ color }}>
                {entry.type === "in" || entry.type === "return" ? "+" : "−"}
                {entry.qty} {typeLabel(entry.type, lang)}
              </div>
              <div className="text-xs text-muted">{entry.date}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
