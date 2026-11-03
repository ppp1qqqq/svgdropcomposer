import type { ObjectId, SizeId, Variant } from '../types';
import { CATALOG, OBJECT_IDS } from '../data/catalog';

interface Props {
  size: SizeId;
  loading: boolean;
  thumb: (objId: ObjectId, variant: Variant) => string | undefined;
  onAdd: (objId: ObjectId, variant: Variant) => void;
}

export function LibraryPanel({ size, loading, thumb, onAdd }: Props) {
  return (
    <div className="library">
      {(['main', 'bg'] as Variant[]).map((variant) => (
        <div key={variant} className="library-group">
          <h3>{variant === 'main' ? 'Главные, цветные' : 'Фоновые, монохром'}</h3>
          <div className="library-grid">
            {OBJECT_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="library-tile"
                onClick={() => onAdd(id, variant)}
                disabled={loading}
                title={`Добавить на холст: ${CATALOG[id].name}${variant === 'bg' ? ', фоновый' : ''}`}
              >
                <span className="library-img">{thumb(id, variant) ? <img src={thumb(id, variant)} alt="" /> : null}</span>
                <span className="library-name">{CATALOG[id].name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="help">Размер {size}: {size === 'L' ? 'подробная прорисовка для крупных форматов' : 'упрощённая прорисовка для мелких превью'}.</p>
    </div>
  );
}
