import type { LayoutMode, LibraryManifest, Mask, ObjectId, Scene, SceneItem, Variant } from '../types';
import { CATALOG } from '../data/catalog';
import { canonicalSize } from './render';
import { mulberry32, shuffle, uid } from './rng';

/**
 * Автоматическая раскладка.
 *
 * Генерируется много случайных, но детерминированных по seed кандидатов,
 * каждый оценивается, лучшие несколько отдаются как варианты.
 *
 * Кандидат строится так:
 *  1. мелкие плоские объекты с вероятностью кладутся на подходящие крупные
 *     (телефон на книгу, пазл на экран телефона, монета на кошелёк),
 *     так сделано в примерах SVG-drop из Figma;
 *  2. получившиеся группы выстраиваются в один-три ряда с небольшим
 *     нахлёстом и ступенькой по высоте, мелкие могут лечь перед соседом;
 *  3. вся группа масштабируется одним коэффициентом в область макета
 *     («собранно» - по центру, «под заголовок» - справа или снизу,
 *     «со смещением» - крупнее и со сдвигом за край);
 *  4. фоновые объекты ставятся позади так, чтобы их частично перекрывали главные.
 *
 * Оценка считает пересечения по маскам занятости (реальная форма объекта,
 * а не рамка), заполнение области, крупность, баланс и выход за край.
 */

export interface LayoutRequest {
  items: { objId: ObjectId; variant: Variant }[];
  width: number;
  height: number;
  mode: LayoutMode;
  seed: number;
}

export interface LayoutResult {
  scale: number;
  items: SceneItem[];
  score: number;
  key: string;
}

interface Node {
  idx: number;
  objId: ObjectId;
  variant: Variant;
  w: number;
  h: number;
  mask: Mask;
  host?: Node;
  guests: Node[];
  /** Позиция левого верхнего угла в канонических единицах. */
  x: number;
  y: number;
}

interface Unit {
  root: Node;
  nodes: Node[];
  minX: number;
  minY: number;
  w: number;
  h: number;
  /** Сдвиг юнита на холсте (левый верх его рамки). */
  ox: number;
  oy: number;
}

const HOST_CAPACITY: Partial<Record<ObjectId, number>> = { book: 2, folder: 2, phone: 1, wallet: 1 };

function isAncestor(a: Node, b: Node): boolean {
  for (let n = b.host; n; n = n.host) if (n === a) return true;
  return false;
}

function depth(n: Node): number {
  let d = 0;
  for (let h = n.host; h; h = h.host) d++;
  return d;
}

/* ---------- Сетка занятости ---------- */

interface Grid {
  cell: number;
  gw: number;
  gh: number;
}

function makeGrid(W: number, H: number): Grid {
  const cell = Math.max(W, H) / 110;
  return { cell, gw: Math.ceil(W / cell), gh: Math.ceil(H / cell) };
}

/** Клетки холста, занятые объектом с рамкой (x, y, w, h) в пикселях. Возвращает и долю за краем. */
function rasterize(grid: Grid, mask: Mask, x: number, y: number, w: number, h: number) {
  const cells = new Uint8Array(grid.gw * grid.gh);
  let inside = 0;
  let total = 0;
  // Шаг выборки по самой маске: каждая её клетка проецируется на холст.
  const mw = w / mask.cols;
  const mh = h / mask.rows;
  for (let r = 0; r < mask.rows; r++) {
    for (let c = 0; c < mask.cols; c++) {
      if (!mask.bits[r * mask.cols + c]) continue;
      total++;
      const px = x + (c + 0.5) * mw;
      const py = y + (r + 0.5) * mh;
      const gx = Math.floor(px / grid.cell);
      const gy = Math.floor(py / grid.cell);
      if (gx < 0 || gy < 0 || gx >= grid.gw || gy >= grid.gh) continue;
      inside++;
      // Маска 40 × N крупнее сетки холста только у очень больших объектов,
      // поэтому закрашиваем и соседние клетки, чтобы не было «дыр».
      const spanX = Math.max(1, Math.ceil(mw / grid.cell));
      const spanY = Math.max(1, Math.ceil(mh / grid.cell));
      for (let dy = 0; dy < spanY; dy++) {
        for (let dx = 0; dx < spanX; dx++) {
          const xx = gx + dx - (spanX >> 1);
          const yy = gy + dy - (spanY >> 1);
          if (xx >= 0 && yy >= 0 && xx < grid.gw && yy < grid.gh) cells[yy * grid.gw + xx] = 1;
        }
      }
    }
  }
  let area = 0;
  for (let i = 0; i < cells.length; i++) area += cells[i];
  return { cells, area, outside: total ? 1 - inside / total : 0 };
}

function overlapCount(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) n++;
  return n;
}

/* ---------- Области макета ---------- */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function layoutRegion(mode: LayoutMode, W: number, H: number): Rect {
  const landscape = W / H >= 1.15;
  if (mode === 'under-title') {
    // Как в примере «Под заголовок»: группа справа, левые ~45 % свободны под текст.
    // В вертикальных форматах текст сверху, группа снизу.
    return landscape
      ? { x: 0.43 * W, y: 0.15 * H, w: 0.54 * W, h: 0.7 * H }
      : { x: 0.06 * W, y: 0.42 * H, w: 0.88 * W, h: 0.53 * H };
  }
  return { x: 0.05 * W, y: 0.09 * H, w: 0.9 * W, h: 0.82 * H };
}

/**
 * Предел крупности: самый большой объект не выше ~60 % холста и не шире
 * половины. В примерах SVG-drop самые крупные объекты занимают 44–57 % по
 * высоте; без предела две-три вещи раздувались бы на весь кадр.
 */
function sizeCap(W: number, H: number, maxW: number, maxH: number): number {
  return Math.min((0.6 * H) / maxH, ((W < H ? 0.64 : 0.5) * W) / maxW);
}

/* ---------- Кандидат ---------- */

type Candidate = LayoutResult;

function buildNodes(req: LayoutRequest, manifest: LibraryManifest): Node[] {
  return req.items.map((it, idx) => {
    const { w, h } = canonicalSize(manifest, it.objId, it.variant);
    return { idx, objId: it.objId, variant: it.variant, w, h, mask: manifest.sizes.L[it.objId][it.variant].mask, guests: [], x: 0, y: 0 };
  });
}

function stack(mains: Node[], rng: () => number) {
  const guests = shuffle(mains.filter((n) => CATALOG[n.objId].restsOn), rng);
  for (const g of guests) {
    if (rng() > 0.72) continue;
    for (const hostId of CATALOG[g.objId].restsOn ?? []) {
      const host = shuffle(mains, rng).find(
        (h) =>
          h !== g &&
          h.objId === hostId &&
          h.guests.length < (HOST_CAPACITY[h.objId] ?? 0) &&
          !isAncestor(g, h) &&
          depth(h) < 2,
      );
      if (host) {
        g.host = host;
        host.guests.push(g);
        break;
      }
    }
  }
}

function placeUnitLocal(root: Node, rng: () => number): Unit {
  const nodes: Node[] = [];
  const visit = (n: Node) => {
    nodes.push(n);
    n.guests.forEach((g, i) => {
      const anchors = CATALOG[n.objId].hostAnchors ?? [[0.5, 0.4]];
      const [ax, ay] = anchors[i % anchors.length];
      const jx = (rng() - 0.5) * 0.06 * n.w;
      const jy = (rng() - 0.5) * 0.04 * n.h;
      g.x = n.x + ax * n.w - g.w / 2 + jx;
      g.y = n.y + ay * n.h - g.h / 2 + jy;
      visit(g);
    });
  };
  root.x = 0;
  root.y = 0;
  visit(root);
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  return { root, nodes, minX, minY, w: maxX - minX, h: maxY - minY, ox: 0, oy: 0 };
}

/** Делит юниты на ряды примерно поровну по ширине и не оставляет в ряду одиночную мелочь. */
function splitRows(units: Unit[], rows: number): Unit[][] {
  if (rows <= 1) return [units];
  const totalW = units.reduce((s, u) => s + u.w, 0);
  const groups: Unit[][] = [];
  let acc = 0;
  let current: Unit[] = [];
  for (const u of units) {
    current.push(u);
    acc += u.w;
    if (groups.length < rows - 1 && acc >= (totalW / rows) * (groups.length + 1)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  const maxArea = Math.max(...units.map((u) => u.w * u.h));
  // Ряд из одного маленького объекта выглядит как случайно оброненный: присоединяем к соседнему.
  for (let i = groups.length - 1; i >= 0 && groups.length > 1; i--) {
    const g = groups[i];
    if (g.length === 1 && g[0].w * g[0].h < 0.45 * maxArea) {
      const target = i > 0 ? i - 1 : i + 1;
      if (i > 0) groups[target].push(...g);
      else groups[target].unshift(...g);
      groups.splice(i, 1);
    }
  }
  return groups;
}

/**
 * Раскладка юнитов в ряды. Ряды центрируются друг относительно друга с
 * небольшим случайным сдвигом и заходят друг на друга по высоте: нижний
 * ряд стоит «ближе» и рисуется поверх верхнего.
 */
function arrangeRows(units: Unit[], rows: number, offsetDir: number, rng: () => number) {
  const maxArea = Math.max(...units.map((u) => u.w * u.h));
  const avgH = units.reduce((s, u) => s + u.h, 0) / units.length;
  const groups = splitRows(units, rows);

  type Placed = Unit & { tucked?: boolean };
  const rowSpans: { row: Placed[]; minX: number; maxX: number }[] = [];
  let rowBottom = 0;
  groups.forEach((row) => {
    let cursor = 0;
    let prev: Placed | null = null;
    const rowH = Math.max(...row.map((u) => u.h));
    row.forEach((u, i) => {
      const unit = u as Placed;
      const small = u.w * u.h < 0.3 * maxArea;
      let bottom: number;
      if (prev && small && !prev.tucked && rng() < 0.45) {
        // Маленький объект ложится перед соседом, ниже его основания (как ручка у лампы в примере).
        unit.ox = prev.ox + rng() * Math.max(0, prev.w - u.w);
        bottom = prev.oy + prev.h + u.h * (0.2 + rng() * 0.2);
        unit.tucked = true;
        cursor = Math.max(cursor, unit.ox + u.w * 0.8);
      } else {
        const overlap = prev ? (0.02 + rng() * 0.12) * Math.min(prev.w, u.w) : 0;
        unit.ox = cursor - overlap;
        const stagger = (i % 2 === 0 ? -1 : 1) * rng() * 0.16 * avgH;
        const diag = offsetDir * i * 0.18 * avgH;
        bottom = rowBottom + stagger - diag;
        cursor = unit.ox + u.w;
      }
      unit.oy = bottom - u.h;
      prev = unit;
    });
    rowSpans.push({ row, minX: Math.min(...row.map((u) => u.ox)), maxX: Math.max(...row.map((u) => u.ox + u.w)) });
    rowBottom += rowH * (0.7 + rng() * 0.18);
  });

  // Центрирование рядов по самому широкому, с небольшим сдвигом для живости.
  const widest = Math.max(...rowSpans.map((r) => r.maxX - r.minX));
  for (const span of rowSpans) {
    const width = span.maxX - span.minX;
    const shift = (widest - width) / 2 - span.minX + (rowSpans.length > 1 ? (rng() - 0.5) * 0.2 * width : 0);
    for (const u of span.row) u.ox += shift;
  }

  for (const u of units) {
    for (const n of u.nodes) {
      n.x = n.x - u.minX + u.ox;
      n.y = n.y - u.minY + u.oy;
    }
  }
}

/** Сколько рядов лучше подходит под пропорции области. */
function preferredRows(units: Unit[], regionAspect: number): number {
  const sumW = units.reduce((s, u) => s + u.w, 0);
  const maxH = Math.max(...units.map((u) => u.h));
  let best = 1;
  let bestDiff = Infinity;
  for (let r = 1; r <= Math.min(3, units.length); r++) {
    const aspect = sumW / r / (maxH * (1 + 0.78 * (r - 1)));
    const diff = Math.abs(Math.log(aspect / regionAspect));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  return best;
}

function candidate(req: LayoutRequest, manifest: LibraryManifest, rng: () => number, grid: Grid): Candidate | null {
  const W = req.width;
  const H = req.height;
  const nodes = buildNodes(req, manifest);
  let mains = nodes.filter((n) => n.variant === 'main');
  let bgs = nodes.filter((n) => n.variant === 'bg');
  if (!mains.length) {
    mains = bgs;
    bgs = [];
  }
  if (!mains.length) return null;

  stack(mains, rng);
  let units = shuffle(mains.filter((n) => !n.host), rng).map((root) => placeUnitLocal(root, rng));

  // Высокие стоящие объекты (лампа, цветы) чаще ставим по краям ряда.
  for (const u of [...units]) {
    if (CATALOG[u.root.objId].standing && rng() < 0.6) {
      units = units.filter((x) => x !== u);
      if (rng() < 0.5) units.unshift(u);
      else units.push(u);
    }
  }

  const region = layoutRegion(req.mode, W, H);
  const maxRows = Math.min(3, units.length);
  const jitter = rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0;
  const rows = Math.min(maxRows, Math.max(1, preferredRows(units, region.w / region.h) + jitter));
  const offsetDir = req.mode === 'offset' ? (rng() < 0.5 ? 1 : -1) : 0;
  arrangeRows(units, rows, offsetDir, rng);

  const minX = Math.min(...mains.map((n) => n.x));
  const minY = Math.min(...mains.map((n) => n.y));
  const bw = Math.max(...mains.map((n) => n.x + n.w)) - minX;
  const bh = Math.max(...mains.map((n) => n.y + n.h)) - minY;

  let s = Math.min(region.w / bw, region.h / bh);
  const maxW = Math.max(...mains.map((n) => n.w));
  const maxH = Math.max(...mains.map((n) => n.h));
  // Один объект не раздуваем на весь холст: оставляем воздух вокруг.
  if (mains.length === 1) s = Math.min(s, (0.55 * region.w) / maxW, (0.7 * region.h) / maxH);
  s = Math.min(s, sizeCap(W, H, maxW, maxH));
  let tx = region.x + (region.w - bw * s) / 2 - minX * s;
  let ty = region.y + (region.h - bh * s) / 2 - minY * s;
  if (req.mode === 'offset') {
    const grow = 1.28;
    const cx = W / 2 + (rng() < 0.5 ? -1 : 1) * 0.13 * W;
    const cy = H / 2 + 0.05 * H;
    s *= grow;
    s = Math.min(s, sizeCap(W, H, maxW, maxH));
    tx = cx - (minX + bw / 2) * s;
    ty = cy - (minY + bh / 2) * s;
  }

  const px = (n: Node) => ({ x: tx + n.x * s, y: ty + n.y * s, w: n.w * s, h: n.h * s });

  // ----- Оценка -----
  const ras = new Map<Node, ReturnType<typeof rasterize>>();
  for (const n of mains) {
    const p = px(n);
    ras.set(n, rasterize(grid, n.mask, p.x, p.y, p.w, p.h));
  }
  let overlapPenalty = 0;
  for (let i = 0; i < mains.length; i++) {
    for (let j = i + 1; j < mains.length; j++) {
      const a = mains[i];
      const b = mains[j];
      if (isAncestor(a, b) || isAncestor(b, a)) continue;
      const ra = ras.get(a)!;
      const rb = ras.get(b)!;
      const ov = overlapCount(ra.cells, rb.cells) / Math.max(1, Math.min(ra.area, rb.area));
      overlapPenalty += Math.max(0, ov - 0.05) * 6;
    }
  }
  let outPenalty = 0;
  let cropped = 0;
  for (const n of mains) {
    const out = ras.get(n)!.outside;
    if (out > 0.04) cropped++;
    outPenalty += req.mode === 'offset' ? Math.max(0, out - 0.3) * 8 : out * 10;
  }
  const union = new Uint8Array(grid.gw * grid.gh);
  for (const r of ras.values()) for (let i = 0; i < union.length; i++) if (r.cells[i]) union[i] = 1;
  let covered = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  const rx0 = Math.floor(region.x / grid.cell);
  const ry0 = Math.floor(region.y / grid.cell);
  const rx1 = Math.ceil((region.x + region.w) / grid.cell);
  const ry1 = Math.ceil((region.y + region.h) / grid.cell);
  for (let y = 0; y < grid.gh; y++) {
    for (let x = 0; x < grid.gw; x++) {
      if (!union[y * grid.gw + x]) continue;
      n++;
      sx += x;
      sy += y;
      if (x >= rx0 && x < rx1 && y >= ry0 && y < ry1) covered++;
    }
  }
  const regionCells = Math.max(1, (rx1 - rx0) * (ry1 - ry0));
  const fill = covered / regionCells;
  const cxr = (rx0 + rx1) / 2;
  const cyr = (ry0 + ry1) / 2;
  const balance = n ? Math.hypot(sx / n - cxr, sy / n - cyr) / Math.hypot(rx1 - rx0, ry1 - ry0) : 0;
  const sizeReward = Math.log(s) * 1.2;
  let score = fill * 2 + sizeReward - overlapPenalty - outPenalty - balance * 3;
  if (req.mode === 'offset' && cropped === 0) score -= 0.4;

  // ----- Фоновые объекты -----
  const placedBg: { node: Node; x: number; y: number; cells: Uint8Array }[] = [];
  for (const b of bgs) {
    const w = b.w * s;
    const h = b.h * s;
    let best: { x: number; y: number; cost: number; cells: Uint8Array } | null = null;
    for (let gy = 0; gy < 6; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        // Фоновые объекты держим возле группы: в макете «под заголовок» место под текст остаётся пустым.
        const zone = req.mode === 'under-title' ? region : { x: 0, y: 0, w: W, h: H };
        const cx = zone.x + ((gx + 0.5 + (rng() - 0.5) * 0.6) / 8) * zone.w;
        const cy = zone.y + ((gy + 0.5 + (rng() - 0.5) * 0.6) / 6) * zone.h;
        const x = cx - w / 2;
        const y = cy - h / 2;
        const r = rasterize(grid, b.mask, x, y, w, h);
        const o = overlapCount(r.cells, union) / Math.max(1, r.area);
        let other = 0;
        for (const p of placedBg) other += overlapCount(r.cells, p.cells) / Math.max(1, r.area);
        const cost = Math.abs(o - 0.3) * 3 + r.outside * 4 + other * 3 + (o < 0.05 ? 1 : 0);
        if (!best || cost < best.cost) best = { x, y, cost, cells: r.cells };
      }
    }
    if (best) {
      placedBg.push({ node: b, x: best.x, y: best.y, cells: best.cells });
      score -= best.cost * 0.3;
    }
  }

  // ----- Порядок слоёв: фон, затем юниты от дальних к ближним, гость над хозяином -----
  const ordered: { node: Node; x: number; y: number }[] = placedBg.map((p) => ({ node: p.node, x: p.x, y: p.y }));
  const unitsByDepth = [...units].sort((a, b) => a.root.y + a.root.h - (b.root.y + b.root.h));
  for (const u of unitsByDepth) {
    const walk = (nd: Node) => {
      const p = px(nd);
      ordered.push({ node: nd, x: p.x, y: p.y });
      nd.guests.forEach(walk);
    };
    walk(u.root);
  }

  const items: SceneItem[] = ordered.map(({ node, x, y }) => ({
    id: uid(),
    objId: node.objId,
    variant: node.variant,
    x: x + (node.w * s) / 2,
    y: y + (node.h * s) / 2,
    rotation: 0,
  }));

  const key =
    units.map((u) => u.nodes.map((nd) => nd.objId).join('>')).join('|') + `#${rows}`;
  return { scale: s, items, score, key };
}

export function layoutVariants(req: LayoutRequest, manifest: LibraryManifest, count = 4, tries = 140): LayoutResult[] {
  const grid = makeGrid(req.width, req.height);
  const all: Candidate[] = [];
  for (let i = 0; i < tries; i++) {
    const rng = mulberry32(req.seed * 7919 + i * 104729 + 17);
    const c = candidate(req, manifest, rng, grid);
    if (c) all.push(c);
  }
  all.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: LayoutResult[] = [];
  for (const c of all) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
    if (out.length >= count) break;
  }
  return out;
}

/**
 * Место для объекта, добавленного вручную: свободнее всего и ближе к центру.
 * Масштаб сцены не меняется, поэтому пропорции к остальным объектам сохраняются.
 */
export function findFreeSpot(scene: Scene, manifest: LibraryManifest, objId: ObjectId, variant: Variant): { x: number; y: number } {
  const W = scene.width;
  const H = scene.height;
  const grid = makeGrid(W, H);
  const union = new Uint8Array(grid.gw * grid.gh);
  for (const it of scene.items) {
    const c = canonicalSize(manifest, it.objId, it.variant);
    const w = c.w * scene.scale;
    const h = c.h * scene.scale;
    const r = rasterize(grid, manifest.sizes.L[it.objId][it.variant].mask, it.x - w / 2, it.y - h / 2, w, h);
    for (let i = 0; i < union.length; i++) if (r.cells[i]) union[i] = 1;
  }
  const c = canonicalSize(manifest, objId, variant);
  const w = c.w * scene.scale;
  const h = c.h * scene.scale;
  const mask = manifest.sizes.L[objId][variant].mask;
  let best = { x: W / 2, y: H / 2, cost: Infinity };
  for (let gy = 0; gy <= 8; gy++) {
    for (let gx = 0; gx <= 10; gx++) {
      const x = (gx / 10) * W;
      const y = (gy / 8) * H;
      const r = rasterize(grid, mask, x - w / 2, y - h / 2, w, h);
      const o = overlapCount(r.cells, union) / Math.max(1, r.area);
      const centre = Math.hypot(x / W - 0.5, y / H - 0.5);
      const cost = o * 3 + r.outside * 5 + centre * 0.8;
      if (cost < best.cost) best = { x, y, cost };
    }
  }
  return { x: best.x, y: best.y };
}
