// Проверки ядра без браузера: npm test
import { readFileSync } from 'node:fs';
import { parseManifest } from '../src/lib/library';
import { layoutVariants } from '../src/lib/layout';
import { sceneToSvg } from '../src/lib/render';
import { parseComponentList, selectForMetaphor, scoreText } from '../src/lib/semantics';
import { paletteFromList, parsePalette } from '../src/lib/palette';
import { PRESET_PALETTES } from '../src/data/palettes';
import { OBJECT_IDS } from '../src/data/catalog';
import type { Scene, SizeId } from '../src/types';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log(`✗ ${name}${detail ? ': ' + detail : ''}`);
  }
}

const manifest = parseManifest(JSON.parse(readFileSync('public/library/manifest.json', 'utf8')));
const packs = {
  L: JSON.parse(readFileSync('public/library/L.json', 'utf8')).objects,
  S: JSON.parse(readFileSync('public/library/S.json', 'utf8')).objects,
};

// --- Смысл ---
const top = (t: string) => [...scoreText(t).entries()].sort((a, b) => b[1].score - a[1].score)[0]?.[0];
check('деньги → монета', top('Как накопить деньги на отпуск') === 'coin', String(top('Как накопить деньги на отпуск')));
check('курс → книга', top('Онлайн-курс для студентов') === 'book');
check('идея → лампа', top('Идея для стартапа') === 'lamp');
check('подкаст → наушники', top('Новый подкаст про музыку') === 'headphones');
check('8 марта → цветы', top('Поздравляем с 8 марта') === 'flowers');
check('документы → папка', top('Как хранить документы') === 'folder');
check('«идет» не ловит лампу', !scoreText('Работа идет').has('lamp'));
check('«розничный» не ловит цветы', !scoreText('розничный магазин').has('flowers'));

const sel = selectForMetaphor('Финансовая грамотность для студентов', { size: 'L', background: 'auto' });
check('L: 3–5 главных', sel.picks.filter((p) => p.variant === 'main').length >= 3 && sel.picks.filter((p) => p.variant === 'main').length <= 5);
check('авто-фон: один фоновый', sel.picks.filter((p) => p.variant === 'bg').length === 1);
check('без повторов', new Set(sel.picks.map((p) => p.objId)).size === sel.picks.length);
const none = selectForMetaphor('ыыы', { size: 'S', background: 'off' });
check('нет совпадений → запасная сцена', none.fallback && none.picks.length >= 2 && !none.picks.some((p) => p.variant === 'bg'));

const list = parseComponentList('книга, 2 монеты и телефон; фон: наушники, лампа\nцветы фоном, слон');
const sig = list.picks.map((p) => `${p.objId}:${p.variant}`).join(',');
check(
  'разбор списка',
  sig === 'book:main,coin:main,coin:main,phone:main,headphones:bg,lamp:bg,flowers:bg',
  sig,
);
check('неизвестное слово', list.unknown.length === 1 && list.unknown[0] === 'слон', list.unknown.join('|'));

// --- Палитры ---
const six = paletteFromList(['#7864D7', '#D7CDF5', '#AA9BF0', '#F9ECB0', '#F9A3AA', '#FFE3E1'], 'x').palette;
check('6 цветов: фон сортируется по светлоте', six.colors.bg1 === '#D7CDF5' && six.colors.bg3 === '#7864D7');
check('6 цветов: ничего не достроено', (six.derived ?? []).length === 0);
const two = parsePalette('#CFE8FF, #FF8A65', 'y').palette;
check('2 цвета: фон 1 сохранён', two.colors.bg1 === '#CFE8FF' && two.colors.obj1 === '#FF8A65');
check('2 цвета: достроены остальные', ['bg2', 'bg3', 'obj2', 'obj3'].every((r) => two.derived?.includes(r as never)));
const json = parsePalette(JSON.stringify({ name: 'Море', background: ['#E0F2F1', '#80CBC4', '#00897B'], objects: ['#FFE082', '#FF7043'] }), 'z').palette;
check('JSON background/objects', json.name === 'Море' && json.colors.bg2 === '#80CBC4' && json.colors.obj2 === '#FF7043');
const roles = parsePalette('{"bg1":"#FFFFFF","obj1":"#FF0000","ink":"#000000"}', 'r').palette;
check('JSON с ролями', roles.colors.bg1 === '#FFFFFF' && roles.colors.ink === '#000000');
let threw = false;
try {
  parsePalette('нет цветов', 'q');
} catch {
  threw = true;
}
check('пустая палитра → понятная ошибка', threw);

// --- Раскладка ---
const req = { items: [{ objId: 'book' as const, variant: 'main' as const }, { objId: 'phone' as const, variant: 'main' as const }, { objId: 'lamp' as const, variant: 'main' as const }, { objId: 'headphones' as const, variant: 'bg' as const }], width: 1200, height: 630, mode: 'assembled' as const, seed: 3 };
const a = layoutVariants(req, manifest, 2);
const b = layoutVariants(req, manifest, 2);
check('раскладка детерминирована', a[0].key === b[0].key && Math.abs(a[0].scale - b[0].scale) < 1e-9 && a[0].items.every((it, i) => Math.abs(it.x - b[0].items[i].x) < 1e-9));
check('все объекты на месте', a[0].items.length === 4);
check('фоновый объект - нижний слой', a[0].items[0].variant === 'bg');

// --- Экспорт: объекты не меняются ---
function pathData(svg: string): string[] {
  return [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}
for (const size of ['L', 'S'] as SizeId[]) {
  for (const id of OBJECT_IDS) {
    for (const variant of ['main', 'bg'] as const) {
      const scene: Scene = {
        width: 1200, height: 630, formatId: 'og', size, paletteId: 'mint', background: { role: 'bg1', decor: 'none' },
        scale: 0.3, items: [{ id: 'x', objId: id, variant, x: 600, y: 315, rotation: 30 }], mode: 'assembled', seed: 1,
      };
      const svg = sceneToSvg(scene, manifest, packs[size], PRESET_PALETTES[2], { metadata: false });
      const source = readFileSync(`figma-export/${size}/${id}.${variant}.svg`, 'utf8');
      const same = JSON.stringify(pathData(svg)) === JSON.stringify(pathData(source));
      check(`${size}/${id}.${variant}: пути совпадают с Figma`, same);
      check(`${size}/${id}.${variant}: все токены заменены`, !svg.includes('@@'));
    }
  }
}

// Перекраска идёт строго по ролям: сиреневый → мятный.
const mint = PRESET_PALETTES[2].colors;
const lav = PRESET_PALETTES[0].colors;
const src = readFileSync('figma-export/L/phone.main.svg', 'utf8');
const scene: Scene = { width: 800, height: 800, formatId: 'x', size: 'L', paletteId: 'mint', background: { role: 'none', decor: 'none' }, scale: 0.5, items: [{ id: 'p', objId: 'phone', variant: 'main', x: 400, y: 400, rotation: 0 }], mode: 'assembled', seed: 1 };
const out = sceneToSvg(scene, manifest, packs.L, PRESET_PALETTES[2], { metadata: false });
const count = (s: string, c: string) => (s.toUpperCase().match(new RegExp(`"${c}"`, 'g')) ?? []).length;
check('корпус телефона: Фон 3 сиреневый → Фон 3 мятный', count(src, lav.bg3) === count(out, mint.bg3) && count(out, lav.bg3) === 0);

console.log(`${passed} проверок прошло${failed ? `, ${failed} не прошло` : ''}`);
if (failed) process.exit(1);
