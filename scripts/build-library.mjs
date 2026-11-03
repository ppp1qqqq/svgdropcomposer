// Сборка библиотеки из экспорта Figma.
//
// Вход:  figma-export/{L,S}/<object>.<main|bg>.svg - объекты как есть из Figma,
//        figma-export/L/backdrop.<lavender|peach>.svg - декор фона.
// Выход: public/library/manifest.json      - размеры, маски занятости, список объектов
//        public/library/L.json, S.json      - шаблоны объектов для каждого размера
//        public/library/svg/{L,S}/*.svg     - чистые SVG для людей (без изменений геометрии)
//
// Геометрия не трогается: из файла берётся содержимое корневого <svg> целиком.
// Меняются только три вещи:
//   1. HEX-цвета базовой (сиреневой) палитры заменяются на токены ролей @@bg1@@ и т.д.,
//      чтобы перекрашивать объект подстановкой, а не правкой путей;
//   2. служебные id вида "Vector_12" убираются (в композиции они дублировались бы);
//   3. id, на которые есть ссылки (clipPath), получают префикс экземпляра @@uid@@.
// Если в файле встретится цвет вне палитры, сборка падает: значит, объект нельзя
// перекрасить без потерь, и это нужно увидеть сразу.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'figma-export');
const OUT = join(root, 'public', 'library');

const OBJECTS = ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'flowers', 'wallet', 'folder', 'pen'];
const SIZES = ['L', 'S'];
const MASK_COLS = 40;

// Роли палитры. Порядок и смысл совпадают с плашками «Цвета фона / Цвета объектов» в Figma.
const ROLE_BY_HEX = {
  lavender: {
    '#D7CDF5': 'bg1', '#AA9BF0': 'bg2', '#7864D7': 'bg3', '#181817': 'ink',
    '#F9ECB0': 'obj1', '#F9A3AA': 'obj2', '#FFE3E1': 'obj3', '#FFFFFF': 'paper', WHITE: 'paper',
  },
  peach: {
    '#FDD7B9': 'bg1', '#FAC896': 'bg2', '#D27532': 'bg3', '#181817': 'ink',
    '#F9ECB0': 'obj1', '#80DADA': 'obj2', '#BEEBEB': 'obj3', '#FFFFFF': 'paper', WHITE: 'paper',
  },
};

// Figma пишет кириллицу в id как байты UTF-8, закодированные по одному: &#208;&#154;...
function decodeFigmaEntities(s) {
  return s.replace(/(?:&#\d{1,3};)+/g, (run) => {
    const bytes = run.match(/\d+/g).map(Number);
    if (bytes.some((b) => b > 255)) return run;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
    } catch {
      return run;
    }
  });
}

function parseSvg(text, file) {
  const m = text.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!m) throw new Error(`Не найден корневой <svg> в ${file}`);
  const vb = m[1].match(/viewBox="([^"]+)"/);
  if (!vb) throw new Error(`Нет viewBox в ${file}`);
  const [x, y, w, h] = vb[1].split(/\s+/).map(Number);
  if (x !== 0 || y !== 0) throw new Error(`viewBox не от нуля в ${file}`);
  return { w, h, body: m[2].trim() };
}

function tokenize(body, paletteName, file) {
  const map = ROLE_BY_HEX[paletteName];
  const unknown = new Set();
  const used = new Set();
  const out = body.replace(/\b(fill|stroke|stop-color)="([^"]+)"/g, (all, attr, value) => {
    if (value === 'none' || value.startsWith('url(')) return all;
    const key = value.toUpperCase();
    const role = map[key];
    if (!role) {
      unknown.add(value);
      return all;
    }
    used.add(role);
    return `${attr}="@@${role}@@"`;
  });
  if (unknown.size) throw new Error(`${file}: цвета вне палитры ${[...unknown].join(', ')}`);
  return { body: out, roles: [...used].sort() };
}

function cleanIds(body) {
  const referenced = new Set([...body.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]));
  let out = body.replace(/\sid="([^"]*)"/g, (all, id) => (referenced.has(id) ? ` id="@@uid@@-${id}"` : ''));
  out = out.replace(/url\(#([^)]+)\)/g, (all, id) => `url(#@@uid@@-${id})`);
  return out;
}

function svgForRaster(file) {
  return readFileSync(file, 'utf8');
}

// Маска занятости: какие клетки сетки покрыты непрозрачными пикселями.
// Нужна раскладке, чтобы считать реальные пересечения, а не пересечения рамок.
function occupancyMask(svgText, w, h) {
  const cols = MASK_COLS;
  const rows = Math.max(4, Math.round((cols * h) / w));
  const scale = 6;
  const rw = cols * scale;
  const resvg = new Resvg(svgText, { fitTo: { mode: 'width', value: rw }, background: 'rgba(0,0,0,0)' });
  const img = resvg.render();
  const px = img.pixels;
  const iw = img.width;
  const ih = img.height;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let bits = '';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * iw) / cols), x1 = Math.floor(((c + 1) * iw) / cols);
      const y0 = Math.floor((r * ih) / rows), y1 = Math.floor(((r + 1) * ih) / rows);
      let on = 0, total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++;
          if (px[(y * iw + x) * 4 + 3] > 64) on++;
        }
      }
      bits += total && on / total > 0.2 ? '1' : '0';
    }
    lines.push(bits);
  }
  // 40 бит строки → 10 hex-символов
  const hex = lines.map((b) => b.match(/.{4}/g).map((n) => parseInt(n, 2).toString(16)).join(''));
  return { cols, rows, rows_hex: hex };
}

function ensure(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function build() {
  ensure(OUT);
  const manifest = { version: 1, generatedAt: new Date().toISOString(), maskCols: MASK_COLS, sizes: {}, backdrops: {} };

  for (const size of SIZES) {
    const pack = { size, objects: {} };
    const meta = {};
    ensure(join(OUT, 'svg', size));
    for (const id of OBJECTS) {
      pack.objects[id] = {};
      meta[id] = {};
      for (const variant of ['main', 'bg']) {
        const file = join(SRC, size, `${id}.${variant}.svg`);
        const raw = readFileSync(file, 'utf8');
        const { w, h, body } = parseSvg(raw, file);
        const tokenized = tokenize(cleanIds(decodeFigmaEntities(body)), 'lavender', file);
        pack.objects[id][variant] = { w, h, body: tokenized.body };
        meta[id][variant] = { w, h, roles: tokenized.roles, mask: occupancyMask(svgForRaster(file), w, h) };
        // Человекочитаемая копия: те же пути, исправленные имена слоёв.
        writeFileSync(join(OUT, 'svg', size, `${id}.${variant}.svg`), decodeFigmaEntities(raw));
      }
    }
    writeFileSync(join(OUT, `${size}.json`), JSON.stringify(pack));
    manifest.sizes[size] = { file: `${size}.json`, objects: meta };
  }

  // Декор фона: два рисунка из Figma, перекрашиваются той же схемой ролей.
  for (const [name, file, pal] of [
    ['strokes', 'backdrop.lavender.svg', 'lavender'],
    ['diagonal', 'backdrop.peach.svg', 'peach'],
  ]) {
    const path = join(SRC, 'L', file);
    const { w, h, body } = parseSvg(readFileSync(path, 'utf8'), path);
    const tokenized = tokenize(cleanIds(decodeFigmaEntities(body)), pal, path);
    manifest.backdrops[name] = { w, h, body: tokenized.body };
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
  const kb = (f) => Math.round(readFileSync(join(OUT, f)).length / 1024);
  console.log(`manifest.json ${kb('manifest.json')} КБ, L.json ${kb('L.json')} КБ, S.json ${kb('S.json')} КБ`);
}

build();
