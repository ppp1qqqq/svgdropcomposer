import { useEffect, useMemo, useState } from 'react';
import type { ObjectId, Palette, SizePack, Variant } from '../types';
import { OBJECT_IDS } from '../data/catalog';
import { assetToSvg } from '../lib/render';

/**
 * Миниатюры объектов в выбранной палитре. Рисуются как <img> с blob-URL:
 * так в списке не появляются тысячи узлов SVG, а перекраска мгновенная.
 */
export function useAssetThumbs(pack: SizePack | null, palette: Palette) {
  const sig = Object.values(palette.colors).join('');
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!pack) return;
    const next: Record<string, string> = {};
    for (const id of OBJECT_IDS) {
      for (const v of ['main', 'bg'] as Variant[]) {
        const svg = assetToSvg(pack[id][v], palette, `t-${id}-${v}`);
        next[`${id}.${v}`] = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      }
    }
    setUrls(next);
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack, sig]);
  return (objId: ObjectId, variant: Variant): string | undefined => urls[`${objId}.${variant}`];
}

/** blob-URL для готовой SVG-строки (миниатюры вариантов). */
export function useSvgUrls(svgs: string[]): string[] {
  const urls = useMemo(() => svgs.map((s) => URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }))), [svgs]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}
