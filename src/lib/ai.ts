import type { ObjectId, SizeId } from '../types';
import { CATALOG, OBJECT_IDS } from '../data/catalog';
import { capability } from './platform';
import type { BackgroundPolicy, PickedObject, Selection } from './semantics';

/**
 * Подбор по смыслу через Claude. Доступен, когда сервис открыт как артефакт
 * Claude (возможность `sample`). Модель выбирает только из каталога: id
 * проверяются, неизвестные отбрасываются, так что новых объектов не появится.
 */

type SampleFn = {
  json<T>(input: string, opts?: { modelTier?: 'quick' | 'default' | 'complex' }): Promise<T>;
};

export function aiAvailable(): Promise<boolean> {
  return capability<SampleFn>('sample').then((s) => !!s);
}

export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const MESSAGES: Record<string, string> = {
  not_granted: 'Доступ к Claude для этой страницы не разрешён. Подбор по словарю работает как обычно.',
  sampling_disabled: 'Claude недоступен для этого аккаунта. Подбор по словарю работает как обычно.',
  rate_limited: 'Слишком много запросов подряд. Попробуйте через минуту.',
  invalid_json: 'Claude ответил не в том формате. Попробуйте ещё раз или переформулируйте заголовок.',
  refused: 'Claude не стал разбирать этот текст. Попробуйте другую формулировку.',
};

export async function aiSelect(text: string, opts: { size: SizeId; background: BackgroundPolicy; count?: number }): Promise<Selection> {
  const sample = await capability<SampleFn>('sample');
  if (!sample) throw new AiError('unavailable', 'Подбор через Claude доступен только в версии, открытой в Claude.');

  const range = opts.count ? String(opts.count) : opts.size === 'L' ? 'от 3 до 5' : '2–3';
  const bgRule =
    opts.background === 'off'
      ? 'фоновых объектов не нужно (background: пустой массив)'
      : opts.background === 'on'
        ? `ровно ${opts.size === 'L' ? 2 : 1} фоновых объекта (background)`
        : 'один фоновый объект (background) для глубины, если он усиливает смысл';
  const catalog = OBJECT_IDS.map((id) => `- ${id}: ${CATALOG[id].name}. ${CATALOG[id].meaning}`).join('\n');

  const prompt = [
    'Ты подбираешь предметы для иллюстрации к заголовку статьи или метафоре.',
    'Придумывать новые предметы нельзя: используй только id из библиотеки ниже.',
    '',
    'Библиотека:',
    catalog,
    '',
    `Заголовок или метафора: «${text.slice(0, 600)}»`,
    '',
    `Выбери ${range} главных предмета по убыванию важности и ${bgRule}.`,
    'Фоновый предмет рисуется монохромом позади главных, он не должен совпадать с главными.',
    'Для каждого предмета дай причину по-русски, до 7 слов, без кавычек.',
    '',
    'Ответь только JSON вида:',
    '{"main":[{"id":"coin","why":"деньги и сбережения"}],"background":[{"id":"book","why":"знания на втором плане"}]}',
  ].join('\n');

  let data: { main?: { id?: string; why?: string }[]; background?: { id?: string; why?: string }[] };
  try {
    data = await sample.json(prompt, { modelTier: 'quick' });
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'upstream_error';
    throw new AiError(code, MESSAGES[code] ?? 'Claude сейчас не ответил. Попробуйте ещё раз.');
  }

  const valid = (id: unknown): id is ObjectId => typeof id === 'string' && (OBJECT_IDS as string[]).includes(id);
  const picks: PickedObject[] = [];
  for (const m of data?.main ?? []) {
    if (valid(m?.id) && picks.length < 6) picks.push({ objId: m.id, variant: 'main', reason: `Claude: ${m.why ?? 'по смыслу'}` });
  }
  const used = new Set(picks.map((p) => p.objId));
  for (const b of data?.background ?? []) {
    if (valid(b?.id) && !used.has(b.id) && opts.background !== 'off') {
      picks.push({ objId: b.id, variant: 'bg', reason: `Claude, фоном: ${b.why ?? 'для глубины'}` });
      used.add(b.id);
    }
  }
  if (!picks.some((p) => p.variant === 'main')) {
    throw new AiError('empty', 'Claude не выбрал ни одного предмета из библиотеки. Попробуйте подробнее описать смысл.');
  }
  return { picks, fallback: false };
}
