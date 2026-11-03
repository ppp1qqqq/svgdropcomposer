import { useRef, useState } from 'react';
import type { Palette, RoleId, Scene } from '../types';
import { ROLE_INFO, ROLE_ORDER } from '../data/palettes';
import { paletteWarnings } from '../lib/palette';
import { normalizeHex } from '../lib/color';
import { Icon, Segmented } from './ui';

interface Props {
  palettes: Palette[];
  current: Palette;
  background: Scene['background'];
  onSelect: (id: string) => void;
  onBackground: (bg: Scene['background']) => void;
  onImportText: (text: string, name: string) => void;
  onImportFile: (file: File) => void;
  onEdit: (role: RoleId, hex: string) => void;
  onCopyPreset: () => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  notes: string[];
}

const STRIP: RoleId[] = ['bg1', 'bg2', 'bg3', 'obj1', 'obj2', 'obj3'];

export function PalettePanel(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const warnings = paletteWarnings(p.current);

  return (
    <div className="palette-panel">
      <div className="palette-list" role="radiogroup" aria-label="Цветовая схема">
        {p.palettes.map((pal) => (
          <button
            key={pal.id}
            type="button"
            role="radio"
            aria-checked={pal.id === p.current.id}
            className={`palette-card ${pal.id === p.current.id ? 'is-on' : ''}`}
            onClick={() => p.onSelect(pal.id)}
          >
            <span className="palette-strip" aria-hidden="true">
              {STRIP.map((r) => (
                <span key={r} style={{ background: pal.colors[r] }} />
              ))}
            </span>
            <span className="palette-name">{pal.name}</span>
          </button>
        ))}
      </div>

      <div className="palette-tools">
        <button type="button" className="btn btn-small" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" />
          Загрузить
        </button>
        <button type="button" className="btn btn-small" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
          Вставить цвета
        </button>
        <button type="button" className="btn btn-small" onClick={p.onExport}>
          <Icon name="download" />
          JSON
        </button>
        <input
          ref={fileRef}
          id="palette-file"
          type="file"
          accept=".json,.txt,.css,.scss,.gpl,.hex,application/json,text/plain,text/css"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {pasteOpen && (
        <form
          className="paste-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!paste.trim()) return;
            p.onImportText(paste, 'Моя палитра');
            setPaste('');
            setPasteOpen(false);
          }}
        >
          <label htmlFor="palette-paste">HEX-коды: сначала фон, затем цвета объектов</label>
          <textarea
            id="palette-paste"
            rows={2}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="#CFE8FF #8EC1F5 #3D7FD1 #FFE08A #FF8A65 #FFD3C4"
          />
          <p className="help">Хватит и двух цветов: фон и акцент. Недостающие тона сервис построит сам.</p>
          <button type="submit" className="btn btn-small btn-primary">
            Применить
          </button>
        </form>
      )}

      {p.notes.length > 0 && (
        <ul className="notes">
          {p.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="roles">
        {ROLE_ORDER.map((role) => {
          const derived = p.current.derived?.includes(role);
          return (
            <label key={role} className="role" title={ROLE_INFO[role].hint}>
              <span className="role-swatch" style={{ background: p.current.colors[role] }}>
                {!p.current.builtIn && (
                  <input
                    type="color"
                    id={`role-${role}`}
                    value={p.current.colors[role].toLowerCase()}
                    onChange={(e) => {
                      const hex = normalizeHex(e.target.value);
                      if (hex) p.onEdit(role, hex);
                    }}
                  />
                )}
              </span>
              <span className="role-text">
                <span className="role-label">
                  {ROLE_INFO[role].label}
                  {derived && <span className="badge" title="Цвет достроен сервисом">авто</span>}
                </span>
                <span className="role-hex">{p.current.colors[role]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {p.current.builtIn ? (
        <button type="button" className="btn btn-small" onClick={p.onCopyPreset}>
          Изменить копию схемы
        </button>
      ) : (
        <button type="button" className="btn btn-small btn-danger" onClick={() => p.onDelete(p.current.id)}>
          <Icon name="trash" />
          Удалить палитру
        </button>
      )}

      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="field">
        <span className="field-label">Фон холста</span>
        <Segmented
          label="Фон холста"
          size="sm"
          value={p.background.role}
          onChange={(role) => p.onBackground({ ...p.background, role })}
          options={[
            { value: 'bg1', label: 'Фон 1' },
            { value: 'bg2', label: 'Фон 2' },
            { value: 'none', label: 'Прозрачный' },
          ]}
        />
        <p className="help">Цвета объектов на фон не ставятся: такое правило в библиотеке.</p>
      </div>
      <div className="field">
        <span className="field-label">Узор фона</span>
        <Segmented
          label="Узор фона"
          size="sm"
          value={p.background.decor}
          onChange={(decor) => p.onBackground({ ...p.background, decor })}
          options={[
            { value: 'none', label: 'Нет' },
            { value: 'strokes', label: 'Штрихи' },
            { value: 'diagonal', label: 'Диагональ' },
          ]}
        />
      </div>
    </div>
  );
}
