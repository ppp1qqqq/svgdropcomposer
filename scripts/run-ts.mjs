// Запуск TypeScript-скрипта из tests/ без отдельного раннера: esbuild уже есть в зависимостях Vite.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const [entry, ...args] = process.argv.slice(2);
// Бандл кладём внутрь проекта, чтобы внешние пакеты находились в node_modules.
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache', 'run-ts');
mkdirSync(dir, { recursive: true });
const outfile = join(dir, 'bundle.mjs');
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile, packages: 'external', logLevel: 'warning' });
process.argv = [process.argv[0], entry, ...args];
await import(pathToFileURL(outfile).href);
