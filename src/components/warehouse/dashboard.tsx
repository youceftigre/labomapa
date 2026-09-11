"use client";

import { Package } from "lucide-react";
import { t } from "@/lib/warehouse/i18n";
import { getName, isActiveMaterial, isValidImageSrc, matchesSearch, stockColor, stockLabel } from "@/lib/warehouse/helpers";
import { useWarehouse } from "@/lib/warehouse/state";
import { setInventoryFilter } from "@/lib/warehouse/engine";
import { cn } from "@/lib/utils";

export function DashboardPanel() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const search = useWarehouse((s) => s.search);

  const entries = Object.entries(inventory).filter(([, item]) => isActiveMaterial(item)).filter(([key, item]) => matchesSearch(key, item, search));
  const low = Object.entries(inventory)
    .filter(([, i]) => isActiveMaterial(i) && i.qty < (i.minQty || 10))
    .map(([name, i]) => ({ ...i, name }));

  return (
    <>
      {low.length > 0 ? (
        <div className="card border-2 border-warn/40 bg-amber-50">
          <h3 className="mb-2 font-bold text-warn">{t(lang, "alertTitle")}</h3>
          <div className="grid gap-1 sm:grid-cols-2">
            {low.map((item) => (
              <div
                key={item.name}
                className="truncate rounded-md bg-white/80 px-2 py-1 text-sm font-semibold"
                style={{ color: item.qty <= 0 ? "var(--color-bad)" : "var(--color-warn)" }}
              >
                {getName(item, item.name, lang)} · {item.qty} {item.unit}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card text-sm text-muted">{t(lang, "lowEmpty")}</div>
      )}

      <div className="card">
        <h2 className="mb-3 text-lg font-bold text-navy">{t(lang, "dashOffice")}</h2>
        {entries.length === 0 ? (
          <p className="py-8 text-center text-muted">{t(lang, "noResults")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-5 md:grid-cols-6">
            {entries.map(([name, item]) => (
              <article
                key={name}
                className="rounded-md border-2 bg-card p-3 text-center shadow-sm"
                style={{ borderColor: stockColor(item.qty, item.minQty) }}
              >
                <Thumb src={item.img || item.imgUrl} alt={`${t(lang, "imageAlt")}: ${getName(item, name, lang)}`} large />
                <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-tight">
                  {getName(item, name, lang)}
                </div>
                <div
                  className="text-lg font-bold tabular-nums"
                  style={{ color: stockColor(item.qty, item.minQty) }}
                >
                  {item.qty}
                </div>
                <div className="text-[10px] text-muted">{stockLabel(item.qty, item.minQty, lang)}</div>
                <div className="truncate text-[10px] text-muted">{item.category || item.section}</div>
                {item.borrowed > 0 ? (
                  <div className="text-[10px] font-semibold text-warn">
                    {t(lang, "borrowedLabel")}: {item.borrowed}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function InventoryPanel() {
  const lang = useWarehouse((s) => s.lang);
  const inventory = useWarehouse((s) => s.inventory);
  const search = useWarehouse((s) => s.search);
  const inventoryFilter = useWarehouse((s) => s.inventoryFilter);
  const entries = Object.entries(inventory)
    .filter(([, item]) => isActiveMaterial(item))
    .filter(([key, item]) => matchesSearch(key, item, search))
    .filter(([, item]) => {
      if (inventoryFilter === "low") return item.qty > 0 && item.qty < (item.minQty || 10);
      if (inventoryFilter === "out") return item.qty <= 0;
      return true;
    });

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-navy">{t(lang, "invOffice")}</h2>
        <div className="flex flex-wrap gap-1">
          {(["all", "low", "out"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setInventoryFilter(id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                inventoryFilter === id
                  ? "border-navy bg-navy text-paper"
                  : "border-line bg-white text-navy hover:bg-navy/5",
              )}
            >
              {t(lang, id === "all" ? "filterAll" : id === "low" ? "filterLow" : "filterOut")}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-navy bg-paper/80 text-navy">
              <th className="p-3 text-start">{t(lang, "thMaterial")}</th>
              <th className="p-3 text-center">{t(lang, "thQty")}</th>
              <th className="p-3 text-center">{t(lang, "thStatus")}</th>
              <th className="p-3 text-center">{t(lang, "thBorrowed")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted">
                  {t(lang, "noResults")}
                </td>
              </tr>
            ) : (
              entries.map(([name, item], idx) => (
                <tr key={name} className={idx % 2 === 0 ? "bg-paper/40" : "bg-card"}>
                  <td className="p-3 font-medium">{getName(item, name, lang)}</td>
                  <td
                    className="p-3 text-center font-bold tabular-nums"
                    style={{ color: stockColor(item.qty, item.minQty) }}
                  >
                    {item.qty}
                  </td>
                  <td className="p-3 text-center text-xs">{stockLabel(item.qty, item.minQty, lang)}</td>
                  <td className="p-3 text-center tabular-nums text-warn">
                    {item.borrowed > 0 ? item.borrowed : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Thumb({ src, alt, large = false }: { src: string; alt?: string; large?: boolean }) {
  if (isValidImageSrc(src)) {
    return (
      <img
        src={src.trim()}
        alt={alt || ""}
        loading="lazy"
        decoding="async"
        className={
          large
            ? "mx-auto size-16 rounded-md border border-line object-cover sm:size-20"
            : "mx-auto size-8 rounded-md border border-line object-cover"
        }
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }
  return (
    <div
      className={`${large ? "size-16 sm:size-20" : "size-8"} mx-auto flex items-center justify-center rounded-md border border-dashed border-line bg-paper text-muted`}
    >
      <Package className="size-4" />
    </div>
  );
}
