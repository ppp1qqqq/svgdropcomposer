import type { AssetTemplate, LibraryManifest, ObjectId, Palette, Scene, SceneItem, SizeId, SizePack, Variant } from '../types';
import { CATALOG } from '../data/catalog';

/** Канонический размер объекта: L-версия из Figma × относительный коэффициент. */
export function canonicalSize(manifest: LibraryManifest, objId: ObjectId, variant: Variant): { w: number; h: number } {
  const meta = manifest.sizes.L[objId][variant];
  const k = CATALOG[objId].k;
  return { w: meta.w * k, h: meta.h * k };
}

export interface ItemGeometry {
  /** Размер рамки объекта на холсте. */
  w: number;
  h: number;
  /** Во сколько раз увеличен исходный SVG выбранного размера. */
  factor: number;
  transform: string;
}

/**
 * Геометрия экземпляра. S-версии в Figma нарисованы вдвое мельче L, поэтому
 * масштаб считается от L-ширины: при переключении размера объект остаётся
 * на месте и того же размера, меняется только детализация.
 */
export function itemGeometry(manifest: LibraryManifest, size: SizeId, scale: number, item: SceneItem): ItemGeometry {
  const asset = manifest.sizes[size][item.objId][item.variant];
  const w = canonicalSize(manifest, item.objId, item.variant).w * scale;
  const factor = w / asset.w;
  const h = asset.h * factor;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const transform =
    `translate(${r(item.x)} ${r(item.y)})` +
    (item.rotation ? ` rotate(${r(item.rotation)})` : '') +
    ` translate(${r(-w / 2)} ${r(-h / 2)}) scale(${r(factor * 1e3) / 1e3})`;
  return { w, h, factor, transform };
}

/** Подстановка цветов палитры и уникального префикса id в шаблон. */
export function fillTemplate(body: string, palette: Palette, uid: string): string {
  return body.replace(/@@(\w+)@@/g, (_, key: string) => {
    if (key === 'uid') return uid;
    return (palette.colors as Record<string, string>)[key] ?? '#FF00FF';
  });
}

export function backgroundFill(scene: Scene, palette: Palette): string | null {
  return scene.background.role === 'none' ? null : palette.colors[scene.background.role];
}

/** Декор фона из Figma масштабируется «по большей стороне» и обрезается холстом. */
export function decorTransform(scene: Scene, decor: AssetTemplate): string {
  const s = Math.max(scene.width / decor.w, scene.height / decor.h);
  const tx = (scene.width - decor.w * s) / 2;
  const ty = (scene.height - decor.h * s) / 2;
  return `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(4)})`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function layerNames(items: SceneItem[]): Map<string, string> {
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  for (const it of items) {
    const base = it.variant === 'bg' ? `${CATALOG[it.objId].name}-фон` : CATALOG[it.objId].name;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    names.set(it.id, n === 1 ? base : `${base}-${n}`);
  }
  return names;
}

export const SCENE_METADATA_ID = 'svg-drop-scene';

/**
 * Итоговый SVG. Каждый объект - отдельная группа с понятным именем слоя
 * (Figma берёт имя из id), внутри - исходные пути из библиотеки без изменений,
 * только с цветами выбранной палитры. В metadata лежит описание сцены,
 * чтобы файл можно было открыть в сервисе и продолжить редактирование.
 */
export function sceneToSvg(
  scene: Scene,
  manifest: LibraryManifest,
  pack: SizePack,
  palette: Palette,
  opts: { title?: string; metadata?: boolean } = {},
): string {
  const { width: W, height: H } = scene;
  const names = layerNames(scene.items);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">`,
  );
  if (opts.title) out.push(`<title>${esc(opts.title)}</title>`);
  if (opts.metadata !== false) {
    const meta = { app: 'svg-drop-composer', version: 1, scene, palette };
    out.push(`<metadata id="${SCENE_METADATA_ID}">${esc(JSON.stringify(meta))}</metadata>`);
  }
  out.push(`<defs><clipPath id="canvas-clip"><rect width="${W}" height="${H}"/></clipPath></defs>`);

  const fill = backgroundFill(scene, palette);
  if (fill || scene.background.decor !== 'none') {
    out.push('<g id="Фон">');
    if (fill) out.push(`<rect width="${W}" height="${H}" fill="${fill}"/>`);
    if (scene.background.decor !== 'none') {
      const decor = manifest.backdrops[scene.background.decor];
      out.push(
        `<g id="Фон-декор" clip-path="url(#canvas-clip)"><g transform="${decorTransform(scene, decor)}">` +
          fillTemplate(decor.body, palette, 'decor') +
          '</g></g>',
      );
    }
    out.push('</g>');
  }

  // Холст обрезает выступающие края сам (viewBox), отдельная маска на группе
  // объектов не нужна: без неё слои в Figma остаются обычными группами.
  out.push('<g id="Объекты">');
  scene.items.forEach((item, i) => {
    const geo = itemGeometry(manifest, scene.size, scene.scale, item);
    const tpl = pack[item.objId][item.variant];
    const name = names.get(item.id) ?? item.objId;
    out.push(
      `<g id="${esc(name)}" data-object="${item.objId}" data-variant="${item.variant}" transform="${geo.transform}">` +
        fillTemplate(tpl.body, palette, `o${i}`) +
        '</g>',
    );
  });
  out.push('</g>');
  out.push('</svg>');
  return out.join('\n');
}

/** Один объект отдельным SVG: для миниатюр в библиотеке и списке слоёв. */
export function assetToSvg(tpl: AssetTemplate, palette: Palette, uid: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tpl.w} ${tpl.h}" fill="none">` +
    fillTemplate(tpl.body, palette, uid) +
    '</svg>'
  );
}

/** Сцена из SVG, сохранённого сервисом. */
export function sceneFromSvg(text: string): { scene: Scene; palette: Palette } {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const meta = doc.getElementById(SCENE_METADATA_ID) ?? doc.querySelector('metadata');
  if (!meta?.textContent) {
    throw new Error('В этом SVG нет описания сцены. Открыть для правки можно только файлы, сохранённые этим сервисом.');
  }
  const data = JSON.parse(meta.textContent) as { app?: string; scene?: Scene; palette?: Palette };
  if (!data.scene || !data.palette || !Array.isArray(data.scene.items)) {
    throw new Error('Описание сцены в файле повреждено.');
  }
  const items = data.scene.items.filter((it) => it && it.objId in CATALOG && (it.variant === 'main' || it.variant === 'bg'));
  return { scene: { ...data.scene, items }, palette: data.palette };
}
