// Готовит версию для публикации артефактом Claude: страница без обёртки
// <html>/<head>/<body> (её добавляет площадка) и библиотека рядом.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'dist-artifact';
const src = readFileSync('dist-single/index.html', 'utf8');
const pick = (re) => [...src.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g).slice(0, 1); // только из <head>: в коде есть шаблон <title> для экспорта
const links = pick(/<link\s[^>]*rel="(?:stylesheet|preconnect)"[^>]*\/?>/g).map((l) => l.replace(/\s+/g, ' '));
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g);
if (scripts.length !== 1) throw new Error('ожидался один встроенный скрипт');
mkdirSync(join(out, 'library'), { recursive: true });
writeFileSync(join(out, 'index.html'), [...title, ...links, ...styles, '<div id="root"></div>', ...scripts].join('\n') + '\n');
for (const f of ['manifest.json', 'L.json', 'S.json']) copyFileSync(join('public/library', f), join(out, 'library', f));
console.log(`готово: ${out}/index.html и ${out}/library/`);
