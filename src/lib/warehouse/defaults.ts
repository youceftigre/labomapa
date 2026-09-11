import type { Material } from "./types";

function item(
  qty: number,
  ar: string,
  fr: string,
  en: string,
  unit = "قطعة",
): Material {
  return {
    qty,
    unit,
    borrowed: 0,
    section: "office",
    category: "office",
    status: "active",
    ar,
    fr,
    en,
    img: "",
    imgUrl: "",
    minQty: 10,
    updatedAt: 0,
  };
}

export const defaultOffice: Record<string, Material> = {
  "marqueur black": item(43, "marqueur black", "Marqueur noir", "Black marker"),
  "baguette a relier": item(7, "baguette a relier", "Baguette à relier", "Binding rod"),
  "قلم التظهير": item(4, "قلم التظهير", "Surligneur", "Highlighter"),
  graveuse: item(1, "graveuse", "Agrafeuse", "Stapler"),
  مقص: item(2, "مقص", "Ciseaux", "Scissors"),
  "agrafes 24/6": item(28, "agrafes 24/6", "Agrafes 24/6", "Staples 24/6"),
  "CD-R": item(50, "CD-R", "CD-R", "CD-R"),
  "أقلام حمراء": item(115, "أقلام حمراء", "Stylos rouges", "Red pens"),
  "pochet CD 2 side": item(400, "pochet CD 2 side", "Pochette CD double face", "CD sleeve double side"),
  "marquer blue": item(42, "marquer blue", "Marqueur bleu", "Blue marker"),
  "papier thermique": item(4, "papier thermique", "Papier thermique", "Thermal paper"),
  "faceur corection tap 12mx5mm": item(8, "faceur corection tap 12mx5mm", "Ruban correcteur 12mx5mm", "Correction tape 12mx5mm"),
  "trobone 31mm": item(28, "trobone 31mm", "Trombone 31mm", "Paper clip 31mm"),
  ممحاة: item(4, "ممحاة", "Gomme", "Eraser"),
  غراء: item(3, "غراء", "Colle", "Glue"),
  thermomètre: item(11, "thermomètre", "Thermomètre", "Thermometer"),
  gratoire: item(1, "gratoire", "Gratoire", "Gratoire"),
  مسطرة: item(6, "مسطرة", "Règle", "Ruler"),
  calculator: item(3, "calculator", "Calculatrice", "Calculator"),
  papier: item(0, "papier", "papier", "papier", "قدعة"),
  "sticky notes": item(22, "sticky notes", "Sticky notes", "Sticky notes"),
  "toneure hp": item(0, "toneure hp", "Toner HP", "HP toner"),
  "مشابك أوراق": item(1, "مشابك أوراق", "Pince à double clip", "Paper clips"),
  "أقلام زرقاء": item(214, "أقلام زرقاء", "Stylos bleus", "Blue pens"),
  "شريط لاصق شفاف": item(7, "شريط لاصق شفاف", "Ruban adhésif transparent", "Transparent tape"),
  "toneur canon": item(4, "toneur canon", "Toner Canon", "Canon toner"),
  "أقلام سوداء": item(37, "أقلام سوداء", "Stylos noirs", "Black pens"),
  "tronone 28mm": item(16, "tronone 28mm", "Trombone 28mm", "Paper clip 28mm"),
  kiteur: item(1, "kiteur", "Kiteur", "Kiteur"),
  "DVD-R": item(50, "DVD-R", "DVD-R", "DVD-R"),
  "grave 31/19": item(2, "grave 31/19", "Agrafe 31/19", "Staple 31/19"),
  "قلم الرصاص": item(44, "قلم الرصاص", "Crayon à papier", "Pencil"),
};

export const firebaseConfig = {
  apiKey: "AIzaSyAZn1okMYzlwpfkI_8pyJQyd_NNk6vhJmk",
  authDomain: "magasine-6f1ef.firebaseapp.com",
  projectId: "magasine-6f1ef",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "magasine-6f1ef.firebasestorage.app",
  messagingSenderId: "522494730439",
  appId: "1:522494730439:web:8cfd445b6ee209f5d4dee2",
};
