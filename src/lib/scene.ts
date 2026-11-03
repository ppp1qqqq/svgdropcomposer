import type { LibraryManifest, Scene, SceneItem } from '../types';
import type { LayoutResult } from './layout';
import { canonicalSize } from './render';
import { uid } from './rng';

/** Чистые операции над сценой. Каждая возвращает новую сцену. */

export function updateItem(scene: Scene, id: string, patch: Partial<SceneItem>): Scene {
  return { ...scene, items: scene.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) };
}

export function removeItem(scene: Scene, id: string): Scene {
  return { ...scene, items: scene.items.filter((it) => it.id !== id) };
}

export function duplicateItem(scene: Scene, id: string): { scene: Scene; newId: string | null } {
  const idx = scene.items.findIndex((it) => it.id === id);
  if (idx < 0) return { scene, newId: null };
  const src = scene.items[idx];
  const offset = Math.max(scene.width, scene.height) * 0.025;
  const copy: SceneItem = { ...src, id: uid(), x: src.x + offset, y: src.y + offset * 0.6 };
  const items = [...scene.items];
  items.splice(idx + 1, 0, copy);
  return { scene: { ...scene, items }, newId: copy.id };
}

/** Перестановка слоя: delta > 0 - выше, delta < 0 - ниже, ±Infinity - на край. */
export function moveLayer(scene: Scene, id: string, delta: number): Scene {
  const idx = scene.items.findIndex((it) => it.id === id);
  if (idx < 0) return scene;
  const target = Math.max(0, Math.min(scene.items.length - 1, Number.isFinite(delta) ? idx + delta : delta > 0 ? Infinity : 0));
  return reorder(scene, idx, target);
}

export function reorder(scene: Scene, from: number, to: number): Scene {
  const items = [...scene.items];
  const [moved] = items.splice(from, 1);
  items.splice(Math.max(0, Math.min(items.length, to)), 0, moved);
  return { ...scene, items };
}

export function rotateItem(scene: Scene, id: string, by: number): Scene {
  return {
    ...scene,
    items: scene.items.map((it) => (it.id === id ? { ...it, rotation: normalizeAngle(it.rotation + by) } : it)),
  };
}

export function normalizeAngle(a: number): number {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return Math.round(r * 10) / 10;
}

/**
 * Масштаб всей группы вокруг её центра. Размеры и расстояния меняются
 * одинаково, поэтому соотношения объектов друг с другом сохраняются.
 */
export function scaleComposition(scene: Scene, manifest: LibraryManifest, nextScale: number): Scene {
  if (!scene.items.length) return { ...scene, scale: nextScale };
  const k = nextScale / scene.scale;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of scene.items) {
    const c = canonicalSize(manifest, it.objId, it.variant);
    const w = (c.w * scene.scale) / 2;
    const h = (c.h * scene.scale) / 2;
    minX = Math.min(minX, it.x - w);
    maxX = Math.max(maxX, it.x + w);
    minY = Math.min(minY, it.y - h);
    maxY = Math.max(maxY, it.y + h);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    ...scene,
    scale: nextScale,
    items: scene.items.map((it) => ({ ...it, x: cx + (it.x - cx) * k, y: cy + (it.y - cy) * k })),
  };
}

export function applyLayout(scene: Scene, layout: LayoutResult): Scene {
  return { ...scene, scale: layout.scale, items: layout.items.map((it) => ({ ...it })) };
}
