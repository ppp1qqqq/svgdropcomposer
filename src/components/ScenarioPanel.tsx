import type { LayoutMode } from '../types';
import type { BackgroundPolicy, PickedObject } from '../lib/semantics';
import { suggestName } from '../lib/semantics';
import { CATALOG } from '../data/catalog';
import { Icon, Segmented } from './ui';

export type ScenarioTab = 'meaning' | 'list';
export type CountOption = 'auto' | '2' | '3' | '4' | '5';

export interface ScenarioResult {
  source: 'dict' | 'ai' | 'list';
  picks: PickedObject[];
  note?: string;
  unknown?: string[];
}

const MEANING_EXAMPLES = [
  'Как начать инвестировать со стипендии',
  'Онлайн-курс для начинающих дизайнеров',
  'Где искать идеи для стартапа',
  'Подкаст о продуктивности',
  'Подарки коллегам к 8 марта',
  'Как навести порядок в документах',
];

const LIST_EXAMPLES = ['книга, телефон, пазл; фон: наушники', 'лампа, ручка, папка', 'кошелёк, 2 монеты, телефон', 'цветы и книга, наушники фоном'];

const MODE_OPTIONS: { value: LayoutMode; label: string; hint: string }[] = [
  { value: 'assembled', label: 'Собранно', hint: 'Плотная группа по центру' },
  { value: 'under-title', label: 'Под заголовок', hint: 'Группа сбоку или снизу, место под текст свободно' },
  { value: 'offset', label: 'Со смещением', hint: 'Крупно, со сдвигом и выходом за край' },
];

interface Props {
  tab: ScenarioTab;
  onTab: (t: ScenarioTab) => void;
  meaningText: string;
  onMeaningText: (s: string) => void;
  listText: string;
  onListText: (s: string) => void;
  mode: LayoutMode;
  onMode: (m: LayoutMode) => void;
  bgPolicy: BackgroundPolicy;
  onBgPolicy: (p: BackgroundPolicy) => void;
  count: CountOption;
  onCount: (c: CountOption) => void;
  onCompose: (source: 'dict' | 'ai' | 'list') => void;
  aiState: 'hidden' | 'ready' | 'busy';
  busy: boolean;
  result: ScenarioResult | null;
  variantUrls: string[];
  activeVariant: number;
  onPickVariant: (i: number) => void;
  onMoreVariants: () => void;
  aspect: number;
}

export function ScenarioPanel(p: Props) {
  const submit = () => p.onCompose(p.tab === 'list' ? 'list' : 'dict');
  return (
    <div className="scenario">
      <div className="tabs" role="tablist" aria-label="Способ сборки">
        <button role="tab" type="button" aria-selected={p.tab === 'meaning'} onClick={() => p.onTab('meaning')}>
          По смыслу
        </button>
        <button role="tab" type="button" aria-selected={p.tab === 'list'} onClick={() => p.onTab('list')}>
          По списку
        </button>
      </div>

      {p.tab === 'meaning' ? (
        <div className="field">
          <label htmlFor="meaning-input">Заголовок или метафора</label>
          <textarea
            id="meaning-input"
            rows={3}
            value={p.meaningText}
            onChange={(e) => p.onMeaningText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="Например: Финансовая грамотность для студентов"
          />
          <div className="chips" aria-label="Примеры">
            {MEANING_EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => p.onMeaningText(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="list-input">Объекты через запятую</label>
          <textarea
            id="list-input"
            rows={3}
            value={p.listText}
            onChange={(e) => p.onListText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="книга, телефон, пазл; фон: наушники"
          />
          <p className="help">
            Можно указать количество («2 монеты») и фоновые объекты: «фон: наушники» или «лампа фоном».
          </p>
          <div className="chips">
            {LIST_EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => p.onListText(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">Макет</span>
        <Segmented label="Макет" size="sm" value={p.mode} options={MODE_OPTIONS} onChange={p.onMode} />
      </div>

      {p.tab === 'meaning' && (
        <div className="field-row">
          <div className="field">
            <span className="field-label">Фоновые объекты</span>
            <Segmented
              label="Фоновые объекты"
              size="sm"
              value={p.bgPolicy}
              onChange={p.onBgPolicy}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: 'on', label: 'Больше' },
                { value: 'off', label: 'Нет' },
              ]}
            />
          </div>
          <div className="field">
            <span className="field-label">Главных</span>
            <Segmented
              label="Количество главных объектов"
              size="sm"
              value={p.count}
              onChange={p.onCount}
              options={[
                { value: 'auto', label: 'Авто' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
                { value: '4', label: '4' },
                { value: '5', label: '5' },
              ]}
            />
          </div>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={p.busy}>
          {p.busy ? 'Собираю…' : 'Собрать композицию'}
        </button>
        {p.tab === 'meaning' && p.aiState !== 'hidden' && (
          <button type="button" className="btn btn-ghost" onClick={() => p.onCompose('ai')} disabled={p.aiState === 'busy' || p.busy}>
            <Icon name="spark" />
            {p.aiState === 'busy' ? 'Claude думает…' : 'Подобрать с Claude'}
          </button>
        )}
      </div>

      {p.result && (
        <div className="result" aria-live="polite">
          <h3>
            {p.result.source === 'ai' ? 'Выбрал Claude' : p.result.source === 'list' ? 'Из списка' : 'Подобрано по словарю смыслов'}
          </h3>
          {p.result.picks.length > 0 && (
            <ul className="picks">
              {p.result.picks.map((pick, i) => (
                <li key={i} className={pick.variant === 'bg' ? 'is-bg' : ''}>
                  <span className="pick-name">
                    {CATALOG[pick.objId].name}
                    {pick.variant === 'bg' && <span className="badge">фон</span>}
                  </span>
                  <span className="pick-why">{pick.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {p.result.note && <p className="note">{p.result.note}</p>}
          {!!p.result.unknown?.length && (
            <p className="note">
              Нет в библиотеке: {p.result.unknown.map((u) => `«${u}»`).join(', ')}.
              {p.result.unknown.map((u) => suggestName(u)).filter(Boolean).length > 0 &&
                ` Возможно, имелось в виду: ${[...new Set(p.result.unknown.map((u) => suggestName(u)).filter(Boolean))].join(', ')}.`}{' '}
              Доступны: {Object.values(CATALOG).map((c) => c.name.toLowerCase()).join(', ')}.
            </p>
          )}
        </div>
      )}

      {p.variantUrls.length > 0 && (
        <div className="variants">
          <div className="variants-head">
            <h3>Варианты раскладки</h3>
            <button type="button" className="btn btn-small" onClick={p.onMoreVariants} disabled={p.busy}>
              <Icon name="shuffle" />
              Ещё
            </button>
          </div>
          <div className="variant-grid" style={{ ['--thumb-aspect' as string]: String(p.aspect) }}>
            {p.variantUrls.map((url, i) => (
              <button
                key={url}
                type="button"
                className={`variant ${i === p.activeVariant ? 'is-active' : ''}`}
                onClick={() => p.onPickVariant(i)}
                aria-label={`Вариант ${i + 1}`}
                aria-pressed={i === p.activeVariant}
              >
                <img src={url} alt="" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
