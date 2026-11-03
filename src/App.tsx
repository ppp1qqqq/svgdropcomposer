import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { LayoutMode, LibraryManifest, ObjectId, Palette, RoleId, Scene, SizeId, SizePack, Variant } from './types';
import { PRESET_PALETTES } from './data/palettes';
import { FORMATS, findFormat } from './data/formats';
import { CATALOG, displayName } from './data/catalog';
import { loadManifest, loadSizePack } from './lib/library';
import { useHistory } from './lib/history';
import { findFreeSpot, layoutVariants, type LayoutResult } from './lib/layout';
import { parseComponentList, selectForMetaphor, type BackgroundPolicy, type PickedObject } from './lib/semantics';
import { aiAvailable, aiSelect, AiError } from './lib/ai';
import { parsePalette, paletteToJson } from './lib/palette';
import { contrast } from './lib/color';
import { sceneFromSvg, sceneToSvg } from './lib/render';
import { applyLayout, duplicateItem, moveLayer, removeItem, reorder, rotateItem, scaleComposition, updateItem } from './lib/scene';
import { copyText, inFigma, insertIntoFigma, readFileText, saveFile } from './lib/platform';
import { load, save } from './lib/storage';
import { uid } from './lib/rng';
import { Stage } from './components/Stage';
import { ScenarioPanel, type CountOption, type ScenarioResult, type ScenarioTab } from './components/ScenarioPanel';
import { LayersPanel } from './components/LayersPanel';
import { LibraryPanel } from './components/LibraryPanel';
import { PalettePanel } from './components/PalettePanel';
import { useAssetThumbs, useSvgUrls } from './components/thumbs';
import { Icon, IconButton, Section, Segmented } from './components/ui';

const DEFAULT_MEANING = 'Как начать инвестировать со стипендии';

function emptyScene(): Scene {
  return {
    width: 1200,
    height: 630,
    formatId: 'og',
    size: 'L',
    paletteId: 'lavender',
    background: { role: 'bg1', decor: 'none' },
    scale: 0.3,
    items: [],
    mode: 'assembled',
    seed: 1,
  };
}

function restoredScene(): Scene {
  const saved = load<Scene>('scene');
  if (saved && Array.isArray(saved.items) && saved.width > 0 && saved.height > 0) {
    return { ...emptyScene(), ...saved, items: saved.items.filter((it) => it.objId in CATALOG) };
  }
  return emptyScene();
}

export default function App() {
  const [manifest, setManifest] = useState<LibraryManifest | null>(null);
  const [packs, setPacks] = useState<Partial<Record<SizeId, SizePack>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const history = useHistory<Scene>(restoredScene);
  const scene = history.present;
  const setScene = history.set;

  const [customPalettes, setCustomPalettes] = useState<Palette[]>(() => load<Palette[]>('palettes') ?? []);
  const palettes = useMemo(() => [...PRESET_PALETTES, ...customPalettes], [customPalettes]);
  const palette = palettes.find((p) => p.id === scene.paletteId) ?? PRESET_PALETTES[0];
  const [paletteNotes, setPaletteNotes] = useState<string[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ScenarioTab>('meaning');
  const [meaningText, setMeaningText] = useState(() => load<string>('meaning') ?? DEFAULT_MEANING);
  const [listText, setListText] = useState(() => load<string>('list') ?? 'книга, телефон, пазл; фон: наушники');
  const [bgPolicy, setBgPolicy] = useState<BackgroundPolicy>('auto');
  const [count, setCount] = useState<CountOption>('auto');
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [variants, setVariants] = useState<LayoutResult[]>([]);
  const [activeVariant, setActiveVariant] = useState(0);
  const [aiState, setAiState] = useState<'hidden' | 'ready' | 'busy'>('hidden');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone?: 'error' } | null>(null);
  const toastTimer = useRef<number>();
  const openRef = useRef<HTMLInputElement>(null);

  const pack = packs[scene.size] ?? null;
  const pick = useRef<PickedObject[] | null>(null);
  // Масштаб, который дала последняя автосборка: от него считается ползунок «Масштаб».
  const [layoutScale, setLayoutScale] = useState<number | null>(null);
  const baseScale = layoutScale ?? scene.scale;

  const notify = useCallback((text: string, tone?: 'error') => {
    setToast({ text, tone });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), tone === 'error' ? 7000 : 3600);
  }, []);

  /* ---------- Загрузка библиотеки ---------- */

  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch((e: Error) => setLoadError(e.message));
    aiAvailable().then((ok) => ok && setAiState('ready'));
  }, []);

  // Подгружаем только тот размер, который выбран сейчас.
  useEffect(() => {
    if (packs[scene.size]) return;
    let alive = true;
    loadSizePack(scene.size)
      .then((p) => alive && setPacks((prev) => ({ ...prev, [scene.size]: p })))
      .catch((e: Error) => setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [scene.size, packs]);

  /* ---------- Сохранение черновика ---------- */

  useEffect(() => {
    const t = window.setTimeout(() => save('scene', scene), 400);
    return () => window.clearTimeout(t);
  }, [scene]);
  useEffect(() => save('palettes', customPalettes), [customPalettes]);
  useEffect(() => save('meaning', meaningText), [meaningText]);
  useEffect(() => save('list', listText), [listText]);

  /* ---------- Сборка ---------- */

  const runLayout = useCallback(
    (picks: PickedObject[], base: Scene, seed: number, opts: { keepNotice?: boolean } = {}) => {
      if (!manifest) return;
      setBusy(true);
      // Даём интерфейсу показать «Собираю…», раскладка занимает доли секунды.
      window.setTimeout(() => {
        const vs = layoutVariants(
          { items: picks.map((p) => ({ objId: p.objId, variant: p.variant })), width: base.width, height: base.height, mode: base.mode, seed },
          manifest,
          4,
        );
        setBusy(false);
        if (!vs.length) {
          if (!opts.keepNotice) notify('Для сборки нужен хотя бы один объект.', 'error');
          return;
        }
        pick.current = picks;
        setVariants(vs);
        setActiveVariant(0);
        setSelectedId(null);
        setLayoutScale(vs[0].scale);
        setScene(applyLayout({ ...base, seed }, vs[0]));
      }, 16);
    },
    [manifest, notify, setScene],
  );

  const compose = useCallback(
    async (source: 'dict' | 'ai' | 'list') => {
      const opts = { size: scene.size, background: bgPolicy, count: count === 'auto' ? undefined : Number(count) };
      if (source === 'list') {
        const parsed = parseComponentList(listText);
        setResult({ source, picks: parsed.picks, unknown: parsed.unknown });
        if (!parsed.picks.length) {
          notify('В списке не нашлось объектов из библиотеки.', 'error');
          return;
        }
        runLayout(parsed.picks, scene, scene.seed);
        return;
      }
      if (!meaningText.trim()) {
        notify('Введите заголовок или метафору.', 'error');
        return;
      }
      if (source === 'ai') {
        setAiState('busy');
        try {
          const sel = await aiSelect(meaningText, opts);
          setResult({ source: 'ai', picks: sel.picks });
          runLayout(sel.picks, scene, scene.seed);
        } catch (e) {
          const err = e as AiError;
          notify(err.message, 'error');
          if (['not_granted', 'sampling_disabled', 'capability_disabled', 'not_declared', 'unavailable'].includes(err.code)) {
            setAiState('hidden');
            return;
          }
        }
        setAiState('ready');
        return;
      }
      const sel = selectForMetaphor(meaningText, opts);
      setResult({ source: 'dict', picks: sel.picks, note: sel.note });
      runLayout(sel.picks, scene, scene.seed);
    },
    [scene, bgPolicy, count, listText, meaningText, notify, runLayout],
  );

  // Первый запуск: сразу показываем собранную композицию, а не пустой холст.
  const booted = useRef(false);
  useEffect(() => {
    if (!manifest || booted.current) return;
    booted.current = true;
    if (!scene.items.length) {
      const sel = selectForMetaphor(meaningText, { size: scene.size, background: 'auto' });
      setResult({ source: 'dict', picks: sel.picks, note: sel.note });
      runLayout(sel.picks, scene, scene.seed);
    }
  }, [manifest, meaningText, runLayout, scene]);

  /** Пересборка текущих объектов: при смене формата или макета. */
  const relayout = useCallback(
    (next: Scene, message?: string) => {
      const picks: PickedObject[] = next.items.map((it) => ({ objId: it.objId, variant: it.variant, reason: '' }));
      if (!picks.length) {
        setScene(next);
        return;
      }
      runLayout(picks, next, next.seed);
      if (message) notify(message);
    },
    [notify, runLayout, setScene],
  );

  const moreVariants = () => {
    const picks = pick.current ?? scene.items.map((it) => ({ objId: it.objId, variant: it.variant, reason: '' }));
    runLayout(picks, scene, scene.seed + 1);
  };

  const variantSvgs = useMemo(() => {
    if (!manifest || !pack) return [];
    return variants.map((v) =>
      sceneToSvg(applyLayout(scene, v), manifest, pack, palette, { metadata: false }),
    );
    // Миниатюры зависят от вариантов, палитры, фона и размера, но не от правок на холсте.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, manifest, pack, palette, scene.background, scene.width, scene.height]);
  const variantUrls = useSvgUrls(variantSvgs);

  /* ---------- Правка сцены ---------- */

  const selected = scene.items.find((it) => it.id === selectedId) ?? null;

  const addObject = (objId: ObjectId, variant: Variant) => {
    if (!manifest) return;
    const spot = findFreeSpot(scene, manifest, objId, variant);
    const item = { id: uid(), objId, variant, x: spot.x, y: spot.y, rotation: 0 };
    // Фоновые объекты ложатся под главные, главные - наверх.
    const firstMain = scene.items.findIndex((it) => it.variant === 'main');
    const items = [...scene.items];
    if (variant === 'bg') items.splice(firstMain < 0 ? items.length : firstMain, 0, item);
    else items.push(item);
    setScene({ ...scene, items });
    setSelectedId(item.id);
  };

  const duplicate = (id: string) => {
    const r = duplicateItem(scene, id);
    setScene(r.scene);
    setSelectedId(r.newId);
  };

  const remove = (id: string) => {
    setScene(removeItem(scene, id));
    if (selectedId === id) setSelectedId(null);
  };

  const setFormat = (formatId: string) => {
    const f = findFormat(formatId);
    if (!f || (f.w === scene.width && f.h === scene.height)) return;
    relayout({ ...scene, formatId, width: f.w, height: f.h }, `Композиция пересобрана под ${f.label}. Вернуть прежнюю: Ctrl+Z.`);
  };

  const setMode = (mode: LayoutMode) => {
    if (mode === scene.mode) return;
    relayout({ ...scene, mode });
  };

  const setSize = (size: SizeId) => {
    if (size === scene.size) return;
    setScene({ ...scene, size });
  };

  /* ---------- Палитры ---------- */

  const addPalette = (pal: Palette, notes: string[]) => {
    setCustomPalettes((prev) => [...prev, pal]);
    setScene({ ...scene, paletteId: pal.id });
    setPaletteNotes(notes);
    notify(`Палитра «${pal.name}» применена.`);
  };

  const importPaletteText = (text: string, name: string) => {
    try {
      const parsed = parsePalette(text, name);
      addPalette(parsed.palette, parsed.notes);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const editRole = (role: RoleId, hex: string) => {
    setCustomPalettes((prev) =>
      prev.map((p) =>
        p.id === palette.id ? { ...p, colors: { ...p.colors, [role]: hex }, derived: (p.derived ?? []).filter((r) => r !== role) } : p,
      ),
    );
  };

  /* ---------- Экспорт и импорт ---------- */

  const buildSvg = () => {
    if (!manifest || !pack) return null;
    const title = result?.source !== 'list' && tab === 'meaning' && meaningText.trim() ? meaningText.trim() : 'Иллюстрация SVG-drop';
    return sceneToSvg(scene, manifest, pack, palette, { title });
  };

  const download = async () => {
    const svg = buildSvg();
    if (!svg) return;
    const name = `illustration-${scene.width}x${scene.height}-${scene.size}.svg`;
    const r = await saveFile(name, svg, 'image/svg+xml');
    if (r === 'saved') notify(`Файл ${name} сохранён.`);
    else if (r === 'unavailable') notify('Скачивание здесь недоступно. Скопируйте SVG кнопкой рядом и вставьте в файл или в Figma.', 'error');
  };

  const insert = () => {
    if (!manifest || !pack) return;
    const svg = sceneToSvg(scene, manifest, pack, palette, { metadata: false });
    const label = tab === 'meaning' && meaningText.trim() ? meaningText.trim().slice(0, 60) : 'Иллюстрация';
    insertIntoFigma(svg, `SVG-drop · ${label} · ${scene.width}×${scene.height} · ${scene.size}`);
    notify('Композиция вставлена на холст Figma отдельным фреймом.');
  };

  const copy = async () => {
    const svg = buildSvg();
    if (!svg) return;
    const ok = await copyText(svg);
    notify(ok ? 'SVG скопирован. В Figma достаточно вставить его на холст: Ctrl+V.' : 'Браузер не дал доступ к буферу обмена.', ok ? undefined : 'error');
  };

  const openSvg = async (file: File) => {
    try {
      const text = await readFileText(file);
      const { scene: loaded, palette: pal } = sceneFromSvg(text);
      if (!palettes.some((p) => p.id === pal.id)) setCustomPalettes((prev) => [...prev, { ...pal, builtIn: false }]);
      setScene({ ...emptyScene(), ...loaded, paletteId: pal.id });
      setLayoutScale(loaded.scale);
      setSelectedId(null);
      setVariants([]);
      notify(`Открыт ${file.name}: ${loaded.items.length} объектов.`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  /* ---------- Клавиатура ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }
      if (!selected) return;
      const step = e.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (nudge[e.key]) {
        e.preventDefault();
        setScene(updateItem(scene, selected.id, { x: selected.x + nudge[e.key][0], y: selected.y + nudge[e.key][1] }));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(selected.id);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate(selected.id);
      } else if (e.key === ']') {
        setScene(moveLayer(scene, selected.id, mod ? Infinity : 1));
      } else if (e.key === '[') {
        setScene(moveLayer(scene, selected.id, mod ? -Infinity : -1));
      } else if (e.key.toLowerCase() === 'r') {
        setScene(rotateItem(scene, selected.id, e.shiftKey ? -15 : 15));
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- Разметка ---------- */

  const thumb = useAssetThumbs(pack, palette);
  const accentInk = contrast('#FFFFFF', palette.colors.bg3) >= contrast('#181817', palette.colors.bg3) ? '#FFFFFF' : '#181817';
  const accentVars = {
    '--accent-ink': accentInk,
    '--accent': palette.colors.bg3,
    '--accent-soft': palette.colors.bg1,
    '--accent-mid': palette.colors.bg2,
  } as CSSProperties;

  if (loadError) {
    return (
      <div className="fatal">
        <h1>Библиотека не загрузилась</h1>
        <p>{loadError}</p>
        <p>Проверьте, что рядом со страницей лежит папка library, и обновите страницу.</p>
      </div>
    );
  }

  return (
    <div className="app" style={accentVars}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span style={{ background: palette.colors.bg1 }} />
            <span style={{ background: palette.colors.obj1 }} />
            <span style={{ background: palette.colors.obj2 }} />
          </span>
          <span className="brand-name">SVG-drop</span>
          <span className="brand-sub">сборщик иллюстраций из библиотеки</span>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={() => openRef.current?.click()} title="Открыть SVG, сохранённый этим сервисом">
            <Icon name="upload" />
            <span className="hide-sm">Открыть SVG</span>
          </button>
          <button type="button" className="btn" onClick={copy} disabled={!pack || !scene.items.length}>
            <Icon name="clipboard" />
            <span className="hide-sm">Копировать SVG</span>
          </button>
          <button type="button" className={`btn ${inFigma ? '' : 'btn-primary'}`} onClick={download} disabled={!pack || !scene.items.length}>
            <Icon name="download" />
            {inFigma ? <span className="hide-sm">Скачать SVG</span> : 'Скачать SVG'}
          </button>
          {inFigma && (
            <button type="button" className="btn btn-primary" onClick={insert} disabled={!pack || !scene.items.length}>
              <Icon name="plus" />
              Вставить в Figma
            </button>
          )}
          <input
            ref={openRef}
            id="open-svg"
            type="file"
            accept=".svg,image/svg+xml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openSvg(f);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="workspace">
        <aside className="panel panel-left" aria-label="Сборка">
          <Section title="Сборка" id="sec-compose">
            <ScenarioPanel
              tab={tab}
              onTab={setTab}
              meaningText={meaningText}
              onMeaningText={setMeaningText}
              listText={listText}
              onListText={setListText}
              mode={scene.mode}
              onMode={setMode}
              bgPolicy={bgPolicy}
              onBgPolicy={setBgPolicy}
              count={count}
              onCount={setCount}
              onCompose={compose}
              aiState={aiState}
              busy={busy || !manifest}
              result={result}
              variantUrls={variantUrls}
              activeVariant={activeVariant}
              onPickVariant={(i) => {
                setActiveVariant(i);
                setSelectedId(null);
                setLayoutScale(variants[i].scale);
                setScene(applyLayout(scene, variants[i]));
              }}
              onMoreVariants={moreVariants}
              aspect={scene.width / scene.height}
            />
          </Section>
        </aside>

        <section className="center" aria-label="Холст">
          <div className="stage-toolbar">
            <label className="select">
              <span className="sr-only">Формат</span>
              <select id="format" value={scene.formatId} onChange={(e) => setFormat(e.target.value)}>
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} · {f.hint}
                  </option>
                ))}
              </select>
            </label>
            <Segmented
              label="Размер иллюстраций"
              value={scene.size}
              onChange={setSize}
              options={[
                { value: 'L', label: 'L', hint: 'Подробная прорисовка' },
                { value: 'S', label: 'S', hint: 'Упрощённая прорисовка для мелких размеров' },
              ]}
            />
            <label className="scale-control" title="Масштаб всей группы. Объекты меняются вместе, пропорции между ними сохраняются.">
              <span>Масштаб</span>
              <input
                id="scale"
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={Math.max(-1, Math.min(1, Math.log2(scene.scale / baseScale)))}
                onPointerDown={() => history.checkpoint()}
                onKeyDown={() => history.checkpoint()}
                onChange={(e) => {
                  if (!manifest) return;
                  const v = Number(e.target.value);
                  history.set(scaleComposition(scene, manifest, baseScale * 2 ** v), false);
                }}
                disabled={!scene.items.length}
              />
              <output htmlFor="scale">{Math.round((scene.scale / baseScale) * 100)} %</output>
            </label>
            <span className="toolbar-spacer" />
            <span className="toolbar-group">
              <IconButton icon="undo" label="Отменить" kbd="Ctrl+Z" onClick={history.undo} disabled={!history.canUndo} />
              <IconButton icon="redo" label="Повторить" kbd="Ctrl+Shift+Z" onClick={history.redo} disabled={!history.canRedo} />
            </span>
          </div>

          <div className="stage-well">
            {manifest ? (
              <Stage
                scene={scene}
                manifest={manifest}
                pack={pack}
                palette={palette}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onBeginEdit={history.checkpoint}
                onLiveChange={(s) => history.set(s, false)}
                showTitleZone={scene.mode === 'under-title'}
              />
            ) : (
              <p className="loading">Загружаю библиотеку…</p>
            )}
            {manifest && !pack && <p className="loading overlay">Подгружаю объекты размера {scene.size}…</p>}
          </div>

          <div className="selection-bar" aria-live="polite">
            {selected ? (
              <>
                <span className="selection-name">{displayName(selected.objId, selected.variant)}</span>
                <span className="selection-meta">{Math.round(selected.rotation)}°</span>
                <IconButton icon="rotl" label="Повернуть на −15°" kbd="Shift+R" onClick={() => setScene(rotateItem(scene, selected.id, -15))} />
                <IconButton icon="rotr" label="Повернуть на 15°" kbd="R" onClick={() => setScene(rotateItem(scene, selected.id, 15))} />
                <IconButton
                  icon="reset"
                  label="Сбросить поворот"
                  onClick={() => setScene(updateItem(scene, selected.id, { rotation: 0 }))}
                  disabled={selected.rotation === 0}
                />
                <span className="bar-sep" />
                <IconButton icon="top" label="На передний план" kbd="Ctrl+]" onClick={() => setScene(moveLayer(scene, selected.id, Infinity))} />
                <IconButton icon="up" label="Выше" kbd="]" onClick={() => setScene(moveLayer(scene, selected.id, 1))} />
                <IconButton icon="down" label="Ниже" kbd="[" onClick={() => setScene(moveLayer(scene, selected.id, -1))} />
                <IconButton icon="bottom" label="На задний план" kbd="Ctrl+[" onClick={() => setScene(moveLayer(scene, selected.id, -Infinity))} />
                <span className="bar-sep" />
                <IconButton icon="copy" label="Дублировать" kbd="Ctrl+D" onClick={() => duplicate(selected.id)} />
                <IconButton icon="trash" label="Удалить" kbd="Delete" onClick={() => remove(selected.id)} />
              </>
            ) : (
              <span className="selection-hint">
                Нажмите на объект, чтобы двигать, поворачивать за круглую ручку, дублировать и менять слой.
              </span>
            )}
          </div>
        </section>

        <aside className="panel panel-right" aria-label="Палитра, слои и библиотека">
          <Section title="Палитра" id="sec-palette">
            <PalettePanel
              palettes={palettes}
              current={palette}
              background={scene.background}
              onSelect={(id) => {
                setPaletteNotes([]);
                setScene({ ...scene, paletteId: id });
              }}
              onBackground={(background) => setScene({ ...scene, background })}
              onImportText={importPaletteText}
              onImportFile={async (file) => importPaletteText(await readFileText(file), file.name.replace(/\.[^.]+$/, ''))}
              onEdit={editRole}
              onCopyPreset={() =>
                addPalette({ ...palette, id: `custom-${uid()}`, name: `${palette.name}, копия`, builtIn: false, derived: [] }, [])
              }
              onDelete={(id) => {
                setCustomPalettes((prev) => prev.filter((p) => p.id !== id));
                setScene({ ...scene, paletteId: 'lavender' });
              }}
              onExport={async () => {
                const r = await saveFile(`palette-${palette.id}.json`, paletteToJson(palette), 'application/json');
                if (r === 'unavailable') notify('Скачивание здесь недоступно.', 'error');
              }}
              notes={paletteNotes}
            />
          </Section>
          <Section title="Слои" id="sec-layers" aside={<span className="count">{scene.items.length}</span>}>
            <LayersPanel
              scene={scene}
              selectedId={selectedId}
              thumb={thumb}
              onSelect={setSelectedId}
              onReorder={(from, to) => setScene(reorder(scene, from, to))}
              onMove={(id, d) => setScene(moveLayer(scene, id, d))}
              onDuplicate={duplicate}
              onRemove={remove}
            />
          </Section>
          <Section title="Библиотека" id="sec-library">
            <LibraryPanel size={scene.size} loading={!pack} thumb={thumb} onAdd={addObject} />
          </Section>
        </aside>
      </main>

      {toast && (
        <div className={`toast ${toast.tone === 'error' ? 'is-error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
