"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Camera, ImagePlus, X } from "lucide-react";
import { closeEdit, saveEdit, showToast } from "@/lib/warehouse/engine";
import { compressImage } from "@/lib/warehouse/images";
import { t } from "@/lib/warehouse/i18n";
import { useWarehouse } from "@/lib/warehouse/state";

export function EditModal() {
  const lang = useWarehouse((s) => s.lang);
  const editingKey = useWarehouse((s) => s.editingKey);
  const inventory = useWarehouse((s) => s.inventory);
  const submitting = useWarehouse((s) => s.submitting);
  const item = editingKey ? inventory[editingKey] : null;

  const [ar, setAr] = useState("");
  const [fr, setFr] = useState("");
  const [en, setEn] = useState("");
  const [unit, setUnit] = useState("");
  const [minQty, setMinQty] = useState("10");
  const [img, setImg] = useState("");
  const [section, setSection] = useState("office");

  useEffect(() => {
    if (!item || !editingKey) return;
    setAr(item.ar || editingKey);
    setFr(item.fr || editingKey);
    setEn(item.en || editingKey);
    setUnit(item.unit || "");
    setMinQty(String(item.minQty || 10));
    setImg(item.img || "");
    setSection(item.section || "office");
  }, [editingKey, item]);

  async function onPick(file: File | undefined) {
    if (!file) return;
    try {
      setImg(await compressImage(file));
    } catch (err) {
      const code = String((err as Error).message);
      showToast(t(lang, code === "image-size" ? "imageTooLarge" : "imageInvalid"), "error");
    }
  }

  return (
    <Dialog.Root open={Boolean(editingKey && item)} onOpenChange={(open) => !open && closeEdit()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed inset-x-3 top-1/2 z-50 max-h-[88dvh] min-w-0 -translate-y-1/2 overflow-x-hidden overflow-y-auto rounded-lg bg-card p-4 shadow-2xl sm:left-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-lg font-bold text-navy">{t(lang, "editTitle")}</Dialog.Title>
            <Dialog.Description className="sr-only">{t(lang, "editTitle")}</Dialog.Description>
            <Dialog.Close className="text-muted hover:text-ink">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {editingKey && item ? (
            <div className="grid min-w-0 gap-3">
              <div className="field min-w-0">
                <label>{t(lang, "nameAr")}</label>
                <input value={ar} onChange={(e) => setAr(e.target.value)} />
              </div>
              <div className="field min-w-0">
                <label>{t(lang, "nameFr")}</label>
                <input value={fr} onChange={(e) => setFr(e.target.value)} />
              </div>
              <div className="field min-w-0">
                <label>{t(lang, "nameEn")}</label>
                <input value={en} onChange={(e) => setEn(e.target.value)} />
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="field min-w-0">
                  <label>{t(lang, "unit")}</label>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} />
                </div>
                <div className="field min-w-0">
                  <label>{t(lang, "minQty")}</label>
                  <input type="number" min={1} value={minQty} onChange={(e) => setMinQty(e.target.value)} />
                </div>
              </div>
              <div className="field min-w-0">
                <label>{t(lang, "section")}</label>
                <input value={section} onChange={(e) => setSection(e.target.value)} />
              </div>
              <div className="flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                {img ? (
                  <img
                    src={img}
                    alt={`${t(lang, "imageAlt")}: ${ar || fr || en || editingKey}`}
                    className="h-auto max-h-48 w-full max-w-full rounded-md border border-line object-contain sm:size-20 sm:object-cover"
                  />
                ) : null}
                <label className="chip justify-center !bg-navy !text-paper">
                  <ImagePlus className="size-3.5" /> {t(lang, "changeImg")}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void onPick(e.target.files?.[0])} />
                </label>
                <label className="chip justify-center !bg-navy-deep !text-paper">
                  <Camera className="size-3.5" /> {t(lang, "captureImg")}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => void onPick(e.target.files?.[0])}
                  />
                </label>
              </div>
              <button
                type="button"
                className="primary-btn"
                disabled={submitting}
                onClick={() =>
                  void saveEdit({
                    key: editingKey,
                    ar,
                    fr,
                    en,
                    unit,
                    minQty,
                    section,
                    category: section,
                    status: item.status || (item.archived ? "archived" : "active"),
                    img: img && img !== item.img ? img : undefined,
                  })
                }
              >
                {t(lang, "btnSave")}
              </button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
