export type AspectRatio = '1:1' | '4:5' | '3:4' | '9:16' | '16:9';

export interface MediaItem {
  mediaId: string;
  base64: string;
  mimeType: string;
}

/** 2 ô upload bên trái + tuỳ chọn. */
export interface InputState {
  // Ô 1: ảnh tư liệu (chủ thể/chất liệu thiết kế: xe, nhân vật, theme...).
  sourceImage: MediaItem | null;
  // Ô 2: ảnh phôi trắng/trơn — canvas để AI in design lên.
  blankImage: MediaItem | null;
  // Ghi chú thêm cho AI (tuỳ chọn): màu, chữ, vị trí in...
  notes: string;
  aspectRatio: AspectRatio;
}

export interface GeneratedResult {
  id: string;
  mediaId: string;
  base64: string;
  mimeType: string;
  prompt: string;
}
