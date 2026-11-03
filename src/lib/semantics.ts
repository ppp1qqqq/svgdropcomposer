import type { ObjectId, SizeId, Variant } from '../types';
import { CATALOG, OBJECT_IDS } from '../data/catalog';

/**
 * Подбор объектов по смыслу (сценарий 1) и разбор списка (сценарий 2).
 *
 * Работает без сети: у каждого объекта есть словарь корней с весами.
 * Совпадение ищется по началу слова, поэтому «финансовой», «финансы» и
 * «финансирование» попадают в один корень «финанс». Короткие корни,
 * которые ловили бы посторонние слова, записаны точными формами («=идея»).
 */

export function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е');
}

export function tokenize(text: string): string[] {
  return normalize(text).match(/[a-zа-я0-9]+/g) ?? [];
}

function matches(key: string, token: string): boolean {
  return key.startsWith('=') ? token === key.slice(1) : token.startsWith(key);
}

export interface ObjectMatch {
  score: number;
  /** Слова из запроса, которые сработали. */
  words: string[];
}

export function scoreText(text: string): Map<ObjectId, ObjectMatch> {
  const tokens = [...new Set(tokenize(text))];
  const result = new Map<ObjectId, ObjectMatch>();
  for (const id of OBJECT_IDS) {
    const sense = CATALOG[id].sense;
    let score = 0;
    const words: string[] = [];
    for (const token of tokens) {
      let best = 0;
      for (const key in sense) {
        if (sense[key] > best && matches(key, token)) best = sense[key];
      }
      if (best) {
        score += best;
        words.push(token);
      }
    }
    if (score) result.set(id, { score, words });
  }
  return result;
}

export interface PickedObject {
  objId: ObjectId;
  variant: Variant;
  reason: string;
}

export interface Selection {
  picks: PickedObject[];
  /** true, если ни одного смыслового совпадения не нашлось. */
  fallback: boolean;
  note?: string;
}

export type BackgroundPolicy = 'auto' | 'on' | 'off';

const LIMITS: Record<SizeId, { min: number; max: number }> = {
  // В примерах SVG-drop: L-композиции из 5–6 объектов, S - из 3.
  L: { min: 3, max: 5 },
  S: { min: 2, max: 3 },
};

const BIG_FIRST: ObjectId[] = ['headphones', 'book', 'folder', 'flowers', 'lamp', 'phone', 'wallet', 'pen', 'puzzle', 'coin'];

function quote(words: string[]): string {
  return words.slice(0, 3).map((w) => `«${w}»`).join(', ');
}

export function selectForMetaphor(
  text: string,
  opts: { size: SizeId; background: BackgroundPolicy; count?: number },
): Selection {
  const scores = scoreText(text);
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || BIG_FIRST.indexOf(a[0]) - BIG_FIRST.indexOf(b[0]));
  const { min, max } = LIMITS[opts.size];
  const target = opts.count ?? Math.max(min, Math.min(max, ranked.filter(([, m]) => m.score >= 2).length));

  const picks: PickedObject[] = [];
  const used = new Set<ObjectId>();
  for (const [id, m] of ranked) {
    if (picks.length >= target) break;
    picks.push({ objId: id, variant: 'main', reason: `по словам ${quote(m.words)}` });
    used.add(id);
  }

  let fallback = false;
  let note: string | undefined;
  if (!picks.length) {
    fallback = true;
    note = 'Прямых смысловых связей не нашлось, поэтому собрана нейтральная сцена «рабочий стол». Уточните заголовок или перечислите объекты во второй вкладке.';
    for (const id of ['book', 'lamp', 'pen'] as ObjectId[]) {
      picks.push({ objId: id, variant: 'main', reason: 'нейтральная сцена' });
      used.add(id);
    }
  }

  // Добор до нужного количества: спутники уже выбранных объектов.
  for (let i = 0; picks.length < target && i < picks.length; i++) {
    const lead = picks[i].objId;
    for (const c of CATALOG[lead].companions) {
      if (picks.length >= target) break;
      if (used.has(c)) continue;
      picks.push({ objId: c, variant: 'main', reason: `дополняет: ${CATALOG[lead].name.toLowerCase()}` });
      used.add(c);
    }
  }

  const bgCount = opts.background === 'off' ? 0 : opts.background === 'on' ? (opts.size === 'L' ? 2 : 1) : 1;
  const bgCandidates: { id: ObjectId; reason: string }[] = [
    ...ranked.filter(([id]) => !used.has(id)).map(([id, m]) => ({ id, reason: `фоном, по словам ${quote(m.words)}` })),
    ...picks.flatMap((p) => CATALOG[p.objId].companions.map((c) => ({ id: c, reason: 'фоном, для глубины' }))),
    ...BIG_FIRST.map((id) => ({ id, reason: 'фоном, для глубины' })),
  ];
  for (const cand of bgCandidates) {
    if (picks.filter((p) => p.variant === 'bg').length >= bgCount) break;
    if (used.has(cand.id)) continue;
    picks.push({ objId: cand.id, variant: 'bg', reason: cand.reason });
    used.add(cand.id);
  }

  return { picks, fallback, note };
}

const NUMBER_WORDS: Record<string, number> = {
  один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, пару: 2, пара: 2,
};
const BG_MARKERS = /^(фон|фоном|фоновый|фоновая|фоновое|фоновые|фоновых|монохром\w*|bg|background)$/;

export interface ListResult {
  picks: PickedObject[];
  unknown: string[];
}

/**
 * Разбор перечня: «книга, 2 монеты, телефон; фон: наушники, лампа».
 * Разделители - запятая, «и», «+», перенос строки, точка с запятой.
 * «фон:» в начале строки или после «;» делает фоновыми все объекты до конца этой части.
 * Слово «фон» / «фоновый» рядом с объектом делает фоновым только его.
 */
export function parseComponentList(text: string): ListResult {
  const picks: PickedObject[] = [];
  const unknown: string[] = [];
  for (const group of normalize(text).split(/[;\n]+/)) {
    let g = group.trim();
    let groupBg = false;
    const head = g.match(/^(на\s+фоне|фоном|фон|фоновые)\s*[:—-]\s*/);
    if (head) {
      groupBg = true;
      g = g.slice(head[0].length);
    }
    for (const segment of g.split(/,|\s+и\s+|\s*\+\s*/)) {
      const tokens = segment.match(/[a-zа-я0-9×]+/g) ?? [];
      if (!tokens.length) continue;
      const segBg = groupBg || tokens.some((t) => BG_MARKERS.test(t));
      let count = 1;
      let found = false;
      for (const t of tokens) {
        const n = /^\d+$/.test(t) ? parseInt(t, 10) : NUMBER_WORDS[t];
        const mult = t.match(/^[x×](\d+)$/);
        if (n) count = n;
        if (mult && picks.length) {
          const last = picks[picks.length - 1];
          for (let i = 1; i < Math.min(4, +mult[1]); i++) picks.push({ ...last });
          continue;
        }
        const id = OBJECT_IDS.find((oid) => CATALOG[oid].names.some((name) => matches(name, t)));
        if (!id) continue;
        found = true;
        const variant: Variant = segBg ? 'bg' : 'main';
        for (let i = 0; i < Math.min(4, count); i++) {
          picks.push({ objId: id, variant, reason: variant === 'bg' ? 'из списка, фоном' : 'из списка' });
        }
        count = 1;
      }
      if (!found && !tokens.every((t) => BG_MARKERS.test(t))) unknown.push(segment.trim());
    }
  }
  return { picks, unknown };
}

/** Подсказка для неизвестного слова: ближайшее название по общему началу. */
export function suggestName(word: string): string | null {
  const w = normalize(word).replace(/[^a-zа-я]/g, '');
  if (w.length < 3) return null;
  let best: { name: string; len: number } | null = null;
  for (const id of OBJECT_IDS) {
    const name = normalize(CATALOG[id].name);
    let len = 0;
    while (len < Math.min(name.length, w.length) && name[len] === w[len]) len++;
    if (len >= 3 && (!best || len > best.len)) best = { name: CATALOG[id].name, len };
  }
  return best?.name ?? null;
}
