type XlsxLib = {
  utils: {
    json_to_sheet: (rows: unknown[]) => unknown;
    book_new: () => { SheetNames: string[]; Sheets: Record<string, unknown> };
    book_append_sheet: (wb: unknown, ws: unknown, name: string) => void;
    sheet_to_json: (sheet: unknown, opts?: { defval?: string }) => Record<string, unknown>[];
  };
  writeFile: (wb: unknown, name: string) => void;
  read: (data: ArrayBuffer, opts: { type: string }) => { SheetNames: string[]; Sheets: Record<string, unknown> };
};

let loading: Promise<XlsxLib> | null = null;

export function loadSheetJS(): Promise<XlsxLib> {
  const w = window as unknown as { XLSX?: XlsxLib };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.async = true;
    script.onload = () => {
      const lib = (window as unknown as { XLSX?: XlsxLib }).XLSX;
      if (!lib) reject(new Error("xlsx"));
      else resolve(lib);
    };
    script.onerror = () => reject(new Error("xlsx"));
    document.head.appendChild(script);
  });
  return loading;
}
