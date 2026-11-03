import type { AssetMeta, LibraryManifest, Mask, ObjectId, SizeId, SizePack, Variant } from '../types';

/**
 * Хранилище библиотеки.
 *
 * manifest.json грузится один раз: в нём размеры рамок и маски занятости для
 * обоих размеров, этого хватает раскладке. Сами шаблоны объектов лежат в
 * L.json и S.json и подгружаются только когда нужен этот размер.
 */

const BASE = 'library/';

interface RawMask {
  cols: number;
  rows: number;
  rows_hex: string[];
}

function decodeMask(raw: RawMask): Mask {
  const bits = new Uint8Array(raw.cols * raw.rows);
  raw.rows_hex.forEach((hex, r) => {
    for (let i = 0; i < hex.length; i++) {
      const nibble = parseInt(hex[i], 16);
      for (let b = 0; b < 4; b++) {
        const c = i * 4 + b;
        if (c < raw.cols) bits[r * raw.cols + c] = (nibble >> (3 - b)) & 1;
      }
    }
  });
  return { cols: raw.cols, rows: raw.rows, bits };
}

let manifestPromise: Promise<LibraryManifest> | null = null;
const packPromises: Partial<Record<SizeId, Promise<SizePack>>> = {};

/**
 * В плагине Figma окно интерфейса не может загружать соседние файлы,
 * поэтому сборка плагина кладёт библиотеку прямо в страницу.
 */
type EmbeddedLibrary = Record<string, unknown>;
declare global {
  interface Window {
    __SVG_DROP_LIBRARY__?: EmbeddedLibrary;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const embedded = typeof window !== 'undefined' ? window.__SVG_DROP_LIBRARY__ : undefined;
  if (embedded && path in embedded) return embedded[path] as T;
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Не удалось загрузить ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

type RawManifest = {
  sizes: Record<SizeId, { objects: Record<ObjectId, Record<Variant, Omit<AssetMeta, 'mask'> & { mask: RawMask }>> }>;
  backdrops: LibraryManifest['backdrops'];
};

export function parseManifest(raw: RawManifest): LibraryManifest {
  const sizes = {} as LibraryManifest['sizes'];
  for (const size of Object.keys(raw.sizes) as SizeId[]) {
    const objects = {} as LibraryManifest['sizes'][SizeId];
    for (const id of Object.keys(raw.sizes[size].objects) as ObjectId[]) {
      const variants = raw.sizes[size].objects[id];
      objects[id] = {
        main: { ...variants.main, mask: decodeMask(variants.main.mask) },
        bg: { ...variants.bg, mask: decodeMask(variants.bg.mask) },
      };
    }
    sizes[size] = objects;
  }
  return { sizes, backdrops: raw.backdrops };
}

export function loadManifest(): Promise<LibraryManifest> {
  manifestPromise ??= getJson<RawManifest>('manifest.json').then(parseManifest);
  manifestPromise.catch(() => (manifestPromise = null));
  return manifestPromise;
}

export function loadSizePack(size: SizeId): Promise<SizePack> {
  const existing = packPromises[size];
  if (existing) return existing;
  const p = getJson<{ objects: SizePack }>(`${size}.json`).then((raw) => raw.objects);
  packPromises[size] = p;
  p.catch(() => delete packPromises[size]);
  return p;
}
