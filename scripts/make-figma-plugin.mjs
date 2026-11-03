// Собирает папку плагина Figma: figma-plugin/ui.html = интерфейс сервиса одним
// файлом + библиотека, встроенная прямо в страницу (окну плагина нельзя читать
// соседние файлы). manifest.json и code.js лежат в figma-plugin/ как исходники.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-figma/index.html', 'utf8');
const library = {
  'manifest.json': JSON.parse(readFileSync('public/library/manifest.json', 'utf8')),
  'L.json': JSON.parse(readFileSync('public/library/L.json', 'utf8')),
  'S.json': JSON.parse(readFileSync('public/library/S.json', 'utf8')),
};
// «</» внутри строки закрыл бы тег <script>, поэтому экранируем.
const data = JSON.stringify(library).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
const inject = `<script>window.__SVG_DROP_LIBRARY__=${data};</script>`;
const marker = '<script type="module"';
if (!html.includes(marker)) throw new Error('в сборке не найден скрипт приложения');
const out = html.replace(marker, `${inject}\n${marker}`);
writeFileSync('figma-plugin/ui.html', out);
console.log(`figma-plugin/ui.html: ${Math.round(out.length / 1024)} КБ`);
