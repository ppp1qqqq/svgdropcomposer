export interface CanvasFormat {
  id: string;
  label: string;
  hint: string;
  w: number;
  h: number;
}

export const FORMATS: CanvasFormat[] = [
  { id: 'og', label: '1200 × 630', hint: 'обложка', w: 1200, h: 630 },
  { id: 'wide', label: '1920 × 1080', hint: 'слайд 16:9', w: 1920, h: 1080 },
  { id: 'square', label: '1080 × 1080', hint: 'квадрат', w: 1080, h: 1080 },
  { id: 'portrait', label: '1080 × 1350', hint: 'пост 4:5', w: 1080, h: 1350 },
  { id: 'story', label: '1080 × 1920', hint: 'сторис 9:16', w: 1080, h: 1920 },
];

export function findFormat(id: string): CanvasFormat | undefined {
  return FORMATS.find((f) => f.id === id);
}
