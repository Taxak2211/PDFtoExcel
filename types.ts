
export interface Transaction {
  date: string;
  description: string;
  debit?: number;
  credit?: number;
  balance?: number;
  currency?: string; // ISO currency code like INR, USD, CAD
  category?: string; // Classified category label
}

export interface RedactionRect {
  id: string; // unique id for UI selection
  x: number; // image-space coordinates
  y: number;
  width: number;
  height: number;
  source: 'auto' | 'manual';
}

export interface RedactionPage {
  baseImage: string; // data URL without masks applied
  rects: RedactionRect[]; // redaction rectangles to apply
}
