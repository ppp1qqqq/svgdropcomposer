import type { Palette, RoleId } from '../types';
import { contrast, distance, extractColors, hexToHsl, hslToHex, mix, normalizeHex } from './color';
import { ROLE_INFO } from '../data/palettes';

const DEFAULT_INK = '#181817';
const DEFAULT_PAPER = '#FFFFFF';
const ROLE_KEYS: RoleId[] = ['bg1', 'bg2', 'bg3', 'ink', 'obj1', 'obj2', 'obj3', 'paper'];

export interface ParsedPalette {
  palette: Palette;
  /** Что сервис достроил сам: показываем человеку, чтобы не было сюрпризов. */
  notes: string[];
}

function hexList(values: unknown[]): string[] {
  return values.map((v) => normalizeHex(String(v))).filter((c): c is string => !!c);
}

function byLightnessDesc(colors: string[]): string[] {
  return [...colors].sort((a, b) => hexToHsl(b).l - hexToHsl(a).l);
}

/**
 * Три тона фона из одного цвета. Цвет человека сохраняется точно, остальные
 * два строятся в том же тоне. Целевые светлоты взяты с трёх схем из Figma:
 * светлый ≈ 86 %, средний ≈ 74 %, тёмный ≈ 56 %.
 */
export function backgroundRamp(base: string): { bg1: string; bg2: string; bg3: string; kept: 'bg1' | 'bg2' | 'bg3' } {
  const { h, s, l } = hexToHsl(base);
  const sat = Math.max(35, Math.min(85, s));
  const tone = (light: number, satShift = 0) => hslToHex({ h, s: sat + satShift, l: light });
  if (l >= 78) return { bg1: base, bg2: tone(74), bg3: tone(56, 8), kept: 'bg1' };
  if (l >= 62) return { bg1: tone(87), bg2: base, bg3: tone(56, 8), kept: 'bg2' };
  return { bg1: tone(87), bg2: tone(74), bg3: base, kept: 'bg3' };
}

/**
 * Сборка палитры из того, что известно. Всё недостающее достраивается и
 * помечается в derived, а в notes пишется человеческое объяснение.
 */
function assemble(
  bgGiven: string[],
  objGiven: string[],
  extra: { ink?: string | null; paper?: string | null },
  name: string,
): ParsedPalette {
  const notes: string[] = [];
  const derived: RoleId[] = [];

  let bg: { bg1: string; bg2: string; bg3: string };
  if (bgGiven.length >= 3) {
    const [bg1, bg2, bg3] = byLightnessDesc(bgGiven.slice(0, 3));
    bg = { bg1, bg2, bg3 };
  } else if (bgGiven.length === 2) {
    const [light, dark] = byLightnessDesc(bgGiven);
    bg = { bg1: light, bg2: mix(light, dark, 0.45), bg3: dark };
    derived.push('bg2');
    notes.push('«Фон 2» смешан из двух ваших цветов фона.');
  } else {
    const base = bgGiven[0] ?? hslToHex({ h: hexToHsl(objGiven[0]).h - 150, s: 55, l: 86 });
    const ramp = backgroundRamp(base);
    bg = { bg1: ramp.bg1, bg2: ramp.bg2, bg3: ramp.bg3 };
    if (bgGiven[0]) {
      for (const r of ['bg1', 'bg2', 'bg3'] as const) if (r !== ramp.kept) derived.push(r);
      notes.push(`Ваш цвет фона стал ролью «${ROLE_INFO[ramp.kept].label}», два других тона построены из него.`);
    } else {
      derived.push('bg1', 'bg2', 'bg3');
      notes.push('Цветов фона не было: все три тона подобраны к цветам объектов.');
    }
  }

  const { h } = hexToHsl(bg.bg2);
  const obj1 = objGiven[0] ?? (derived.push('obj1'), hslToHex({ h: h + 150, s: 85, l: 84 }));
  let obj2 = objGiven[1];
  if (!obj2) {
    derived.push('obj2');
    const candidate = hslToHex({ h: h + 110, s: 80, l: 70 });
    const hueGap = Math.abs(((hexToHsl(candidate).h - hexToHsl(obj1).h + 540) % 360) - 180);
    obj2 = hueGap < 40 ? hslToHex({ h: h + 200, s: 80, l: 68 }) : candidate;
  }
  // В схемах Figma «Объект 3» всегда светлый оттенок «Объекта 2».
  const obj3 = objGiven[2] ?? (derived.push('obj3'), mix(obj2, DEFAULT_PAPER, 0.55));
  const derivedObj = derived.filter((r) => r.startsWith('obj'));
  if (derivedObj.length) notes.push(`Достроены: ${derivedObj.map((r) => ROLE_INFO[r].label).join(', ')}.`);

  return {
    palette: {
      id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name,
      colors: { ...bg, obj1, obj2, obj3, ink: extra.ink ?? DEFAULT_INK, paper: extra.paper ?? DEFAULT_PAPER },
      derived,
    },
    notes,
  };
}

/**
 * Палитра из списка цветов без подписей.
 * 6 и больше: три фона, три цвета объектов, затем контур и белый.
 * Меньше шести: первые (n − 3, но не меньше одного) - фон, остальные - объекты.
 */
export function paletteFromList(list: string[], name: string): ParsedPalette {
  const colors = hexList(list);
  if (!colors.length) throw new Error('В палитре не нашлось ни одного цвета. Нужны коды вида #AABBCC.');
  const bgCount = colors.length >= 6 ? 3 : Math.max(1, colors.length - 3);
  const rest = colors.slice(bgCount);
  return assemble(colors.slice(0, bgCount), rest.slice(0, 3), { ink: rest[3], paper: rest[4] }, name);
}

/**
 * Разбор загруженной палитры. Понимает:
 *  • JSON {"name", "background": [...], "objects": [...], "ink"?, "paper"?} - формат экспорта сервиса;
 *  • JSON с ролями {"bg1": "#…", …} или {"colors": {"bg1": …}};
 *  • JSON-массив цветов, CSS-переменные, обычный текст - любые HEX и rgb() по порядку.
 */
export function parsePalette(text: string, fallbackName: string): ParsedPalette {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Файл пустой.');

  let json: unknown;
  try {
    json = trimmed.startsWith('{') || trimmed.startsWith('[') ? JSON.parse(trimmed) : undefined;
  } catch {
    json = undefined;
  }

  if (Array.isArray(json)) return paletteFromList(json.map(String), fallbackName);

  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : fallbackName;
    const one = (v: unknown) => (typeof v === 'string' ? normalizeHex(v) : null);

    const roleSource = (obj.colors && typeof obj.colors === 'object' && !Array.isArray(obj.colors)
      ? obj.colors
      : obj) as Record<string, unknown>;
    const roles = Object.fromEntries(ROLE_KEYS.map((r) => [r, one(roleSource[r])])) as Record<RoleId, string | null>;
    if (ROLE_KEYS.filter((r) => roles[r]).length >= 2) {
      const pick = (keys: RoleId[]) => keys.map((k) => roles[k]).filter((c): c is string => !!c);
      const parsed = assemble(pick(['bg1', 'bg2', 'bg3']), pick(['obj1', 'obj2', 'obj3']), roles, name);
      // Явно заданные роли важнее порядка по светлоте.
      for (const r of ROLE_KEYS) {
        if (roles[r]) parsed.palette.colors[r] = roles[r] as string;
      }
      parsed.palette.derived = (parsed.palette.derived ?? []).filter((r) => !roles[r]);
      return parsed;
    }

    const listOf = (v: unknown) => (Array.isArray(v) ? hexList(v) : typeof v === 'string' ? extractColors(v) : []);
    const bg = listOf(obj.background ?? obj.bg ?? obj['фон']);
    const objects = listOf(obj.objects ?? obj.obj ?? obj['объекты']);
    if (bg.length || objects.length) {
      return assemble(bg, objects.slice(0, 3), { ink: one(obj.ink), paper: one(obj.paper) }, name);
    }
    return paletteFromList(extractColors(trimmed), name);
  }

  return paletteFromList(extractColors(trimmed), fallbackName);
}

/** Предупреждения о палитре: правила из Figma и читаемость. */
export function paletteWarnings(p: Palette): string[] {
  const c = p.colors;
  const out: string[] = [];
  for (const r of ['obj1', 'obj2', 'obj3'] as const) {
    if (distance(c[r], c.bg1) < 28) {
      out.push(`«${ROLE_INFO[r].label}» почти совпадает с основным фоном: детали этого цвета сольются с фоном.`);
    }
  }
  if (contrast(c.ink, c.bg1) < 3) out.push('Контур плохо читается на основном фоне: контраст ниже 3:1.');
  if (contrast(c.bg3, c.bg1) < 1.6) out.push('Фоновые объекты будут почти не видны: «Фон 3» слишком близок к «Фону 1».');
  return out;
}

export function paletteToJson(p: Palette): string {
  const c = p.colors;
  return JSON.stringify(
    { name: p.name, background: [c.bg1, c.bg2, c.bg3], objects: [c.obj1, c.obj2, c.obj3], ink: c.ink, paper: c.paper },
    null,
    2,
  );
}
