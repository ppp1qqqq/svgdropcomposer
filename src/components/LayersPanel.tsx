import { useState } from 'react';
import type { ObjectId, Scene, Variant } from '../types';
import { displayName } from '../data/catalog';
import { Icon } from './ui';

interface Props {
  scene: Scene;
  selectedId: string | null;
  thumb: (objId: ObjectId, variant: Variant) => string | undefined;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onMove: (id: string, delta: number) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}

/** Список слоёв сверху вниз, как в Figma. Перетаскивание строк меняет порядок. */
export function LayersPanel({ scene, selectedId, thumb, onSelect, onReorder, onMove, onDuplicate, onRemove }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const n = scene.items.length;
  if (!n) return <p className="empty">Холст пуст. Соберите композицию слева или добавьте объект из библиотеки.</p>;

  // Индекс в массиве сцены (снизу вверх) ↔ позиция в списке (сверху вниз).
  const rows = scene.items.map((item, index) => ({ item, index })).reverse();

  return (
    <ol className="layers" aria-label="Слои">
      {rows.map(({ item, index }, pos) => (
        <li
          key={item.id}
          className={`layer ${item.id === selectedId ? 'is-selected' : ''} ${dropAt === pos && dragFrom !== null ? 'is-drop' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragFrom(index);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDropAt(pos);
          }}
          onDragLeave={() => setDropAt((d) => (d === pos ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragFrom !== null) onReorder(dragFrom, index);
            setDragFrom(null);
            setDropAt(null);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDropAt(null);
          }}
        >
          <button type="button" className="layer-main" onClick={() => onSelect(item.id)} aria-pressed={item.id === selectedId}>
            <span className="layer-grip" aria-hidden="true">
              <Icon name="grip" size={14} />
            </span>
            <span className="layer-thumb">{thumb(item.objId, item.variant) && <img src={thumb(item.objId, item.variant)} alt="" />}</span>
            <span className="layer-name">{displayName(item.objId, item.variant)}</span>
            {item.rotation !== 0 && <span className="layer-meta">{Math.round(item.rotation)}°</span>}
          </button>
          <span className="layer-actions">
            <button type="button" className="icon-btn" onClick={() => onMove(item.id, 1)} disabled={index === n - 1} aria-label="Выше" title="Выше (])">
              <Icon name="up" size={14} />
            </button>
            <button type="button" className="icon-btn" onClick={() => onMove(item.id, -1)} disabled={index === 0} aria-label="Ниже" title="Ниже ([)">
              <Icon name="down" size={14} />
            </button>
            <button type="button" className="icon-btn" onClick={() => onDuplicate(item.id)} aria-label="Дублировать" title="Дублировать (Ctrl+D)">
              <Icon name="copy" size={14} />
            </button>
            <button type="button" className="icon-btn" onClick={() => onRemove(item.id)} aria-label="Удалить" title="Удалить (Delete)">
              <Icon name="trash" size={14} />
            </button>
          </span>
        </li>
      ))}
    </ol>
  );
}
