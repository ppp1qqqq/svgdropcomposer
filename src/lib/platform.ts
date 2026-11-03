/**
 * Всё, что зависит от среды запуска.
 *
 * Сервис работает и как обычная страница (GitHub Pages, vite preview), и как
 * опубликованный артефакт Claude. В артефакте прямые скачивания запрещены
 * песочницей, поэтому файлы отдаются через возможность `downloads`, а подбор
 * по смыслу может использовать Claude через возможность `sample`.
 */

/** Сборка в режиме плагина Figma (vite build --mode figma). */
export const inFigma = import.meta.env.MODE === 'figma';

/** Отправка готового SVG в основной код плагина: он создаст слои на холсте. */
export function insertIntoFigma(svg: string, name: string): void {
  parent.postMessage({ pluginMessage: { type: 'insert-svg', svg, name } }, '*');
}

interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

function runtime(): ClaudeRuntime | null {
  const c = (window as unknown as { claude?: ClaudeRuntime }).claude;
  return c && typeof c.use === 'function' ? c : null;
}

export const insideClaudeViewer = (): boolean => runtime() !== null;

const capabilityCache = new Map<string, Promise<unknown>>();

export function capability<T>(name: string): Promise<T | null> {
  const rt = runtime();
  if (!rt) return Promise.resolve(null);
  if (!capabilityCache.has(name)) {
    capabilityCache.set(
      name,
      rt.use(name).catch(() => null),
    );
  }
  return capabilityCache.get(name) as Promise<T | null>;
}

interface Downloads {
  save(req: { filename: string; data: string | Blob }): Promise<{ status: string }>;
}

export type SaveOutcome = 'saved' | 'declined' | 'unavailable';

export async function saveFile(filename: string, data: string, mime: string): Promise<SaveOutcome> {
  if (insideClaudeViewer()) {
    const downloads = await capability<Downloads>('downloads');
    if (!downloads) return 'unavailable';
    try {
      await downloads.save({ filename, data });
      return 'saved';
    } catch (e) {
      const code = (e as { code?: string })?.code;
      return code === 'declined' ? 'declined' : 'unavailable';
    }
  }
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}

/** Копирование в буфер. Вызывать прямо из обработчика клика. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Не удалось прочитать файл.'));
    r.readAsText(file);
  });
}
