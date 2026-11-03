import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Обычная сборка: dist/ для GitHub Pages или любого статического хостинга.
// `--mode single`: JS и CSS встраиваются в index.html, библиотека остаётся
// отдельными файлами в dist/library и подгружается по требованию.
// `--mode figma`: то же одним файлом, дальше scripts/make-figma-plugin.mjs
// встраивает библиотеку и собирает папку плагина figma-plugin/.
export default defineConfig(({ mode }) => {
  const single = mode === 'single' || mode === 'figma';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    publicDir: mode === 'figma' ? false : 'public',
    build: {
      outDir: mode === 'figma' ? 'dist-figma' : single ? 'dist-single' : 'dist',
      target: 'es2020',
    },
  };
});
