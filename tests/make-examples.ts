// Примеры для README и сдачи: собираются тем же кодом, что и в интерфейсе.
// node scripts/run-ts.mjs tests/make-examples.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { parseManifest } from '../src/lib/library';
import { layoutVariants } from '../src/lib/layout';
import { sceneToSvg } from '../src/lib/render';
import { parseComponentList, selectForMetaphor } from '../src/lib/semantics';
import { PRESET_PALETTES } from '../src/data/palettes';
import type { LayoutMode, Scene, SizeId } from '../src/types';

const manifest = parseManifest(JSON.parse(readFileSync('public/library/manifest.json', 'utf8')));
const packs = { L: JSON.parse(readFileSync('public/library/L.json', 'utf8')).objects, S: JSON.parse(readFileSync('public/library/S.json', 'utf8')).objects };
const outDir = process.argv[2] ?? 'examples';
mkdirSync(outDir, { recursive: true });

interface Example {
  file: string;
  title: string;
  how: 'meaning' | 'list';
  text: string;
  size: SizeId;
  w: number;
  h: number;
  palette: number;
  mode: LayoutMode;
  seed: number;
  variant?: number;
  decor?: 'none' | 'strokes' | 'diagonal';
}

const examples: Example[] = JSON.parse(process.argv[3] ?? 'null') ?? [
  { file: '01-investments-1200x630', title: 'Как начать инвестировать со стипендии', how: 'meaning', text: 'Как начать инвестировать со стипендии', size: 'L', w: 1200, h: 630, palette: 0, mode: 'assembled', seed: 1, variant: 2 },
  { file: '02-online-course-1080x1080', title: 'Онлайн-курс для начинающих дизайнеров', how: 'meaning', text: 'Онлайн-курс для начинающих дизайнеров', size: 'L', w: 1080, h: 1080, palette: 2, mode: 'under-title', seed: 1, variant: 0 },
  { file: '03-startup-ideas-1200x630-S', title: 'Где искать идеи для стартапа', how: 'list', text: 'лампа, пазл, телефон; фон: книга', size: 'S', w: 1200, h: 630, palette: 1, mode: 'offset', seed: 1 },
];

for (const ex of examples) {
  const picks = ex.how === 'meaning' ? selectForMetaphor(ex.text, { size: ex.size, background: 'auto' }).picks : parseComponentList(ex.text).picks;
  const vs = layoutVariants({ items: picks.map((p) => ({ objId: p.objId, variant: p.variant })), width: ex.w, height: ex.h, mode: ex.mode, seed: ex.seed }, manifest, 4);
  vs.forEach((v, i) => {
    const pal = PRESET_PALETTES[ex.palette];
    const scene: Scene = { width: ex.w, height: ex.h, formatId: 'custom', size: ex.size, paletteId: pal.id, background: { role: 'bg1', decor: ex.decor ?? 'none' }, scale: v.scale, items: v.items, mode: ex.mode, seed: ex.seed };
    const svg = sceneToSvg(scene, manifest, packs[ex.size], pal, { title: ex.title });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 900 } }).render().asPng();
    if (i === (ex.variant ?? 0)) {
      writeFileSync(`${outDir}/${ex.file}.svg`, svg);
      writeFileSync(`${outDir}/${ex.file}.png`, png);
    }
    writeFileSync(`${outDir}/.v-${ex.file}-${i}.png`, png);
  });
  console.log(ex.file, picks.map((p) => `${p.objId}:${p.variant}`).join(','), vs.map((v) => v.key).join(' ; '));
}
