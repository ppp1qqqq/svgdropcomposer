import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { LibraryManifest, Palette, Scene, SceneItem, SizePack } from '../types';
import { backgroundFill, decorTransform, fillTemplate, itemGeometry } from '../lib/render';
import { layoutRegion } from '../lib/layout';
import { normalizeAngle, updateItem } from '../lib/scene';
import { displayName } from '../data/catalog';

interface StageProps {
  scene: Scene;
  manifest: LibraryManifest;
  pack: SizePack | null;
  palette: Palette;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Начало перетаскивания или поворота: точка отмены. */
  onBeginEdit: () => void;
  /** Промежуточное изменение без записи в историю. */
  onLiveChange: (scene: Scene) => void;
  showTitleZone: boolean;
}

type Drag =
  | { kind: 'move'; id: string; pointerId: number; dx: number; dy: number; moved: boolean }
  | { kind: 'rotate'; id: string; pointerId: number; cx: number; cy: number; a0: number; r0: number };

const ItemView = memo(function ItemView({
  item,
  transform,
  markup,
  label,
  onPointerDown,
}: {
  item: SceneItem;
  transform: string;
  markup: string;
  label: string;
  onPointerDown: (e: ReactPointerEvent<SVGGElement>, item: SceneItem) => void;
}) {
  return (
    <g
      className="stage-item"
      data-id={item.id}
      transform={transform}
      onPointerDown={(e) => onPointerDown(e, item)}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
});

export function Stage(props: StageProps) {
  const { scene, manifest, pack, palette, selectedId } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const [unit, setUnit] = useState(1);

  // Пикселей экрана на единицу холста: нужен, чтобы рамка выделения и ручки
  // были одной толщины при любом масштабе.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setUnit(Math.max(0.05, Math.min(r.width / scene.width, r.height / scene.height)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scene.width, scene.height]);

  const paletteSig = Object.values(palette.colors).join('');
  const markupCache = useMemo(() => new Map<string, string>(), [pack, paletteSig]);
  const markupFor = (item: SceneItem) => {
    if (!pack) return '';
    const key = `${item.objId}.${item.variant}`;
    let m = markupCache.get(key);
    if (m === undefined) {
      m = fillTemplate(pack[item.objId][item.variant].body, palette, key);
      markupCache.set(key, m);
    }
    return m;
  };

  const toCanvas = (clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };

  const startMove = (e: ReactPointerEvent<SVGGElement>, item: SceneItem) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    props.onSelect(item.id);
    const p = toCanvas(e.clientX, e.clientY);
    drag.current = { kind: 'move', id: item.id, pointerId: e.pointerId, dx: p.x - item.x, dy: p.y - item.y, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const startRotate = (e: ReactPointerEvent<SVGCircleElement>, item: SceneItem) => {
    e.stopPropagation();
    const p = toCanvas(e.clientX, e.clientY);
    props.onBeginEdit();
    drag.current = {
      kind: 'rotate',
      id: item.id,
      pointerId: e.pointerId,
      cx: item.x,
      cy: item.y,
      a0: Math.atan2(p.y - item.y, p.x - item.x),
      r0: item.rotation,
    };
    svgRef.current?.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = toCanvas(e.clientX, e.clientY);
    if (d.kind === 'move') {
      if (!d.moved) {
        props.onBeginEdit();
        d.moved = true;
      }
      props.onLiveChange(updateItem(sceneRef.current, d.id, { x: p.x - d.dx, y: p.y - d.dy }));
    } else {
      let deg = d.r0 + ((Math.atan2(p.y - d.cy, p.x - d.cx) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      props.onLiveChange(updateItem(sceneRef.current, d.id, { rotation: normalizeAngle(deg) }));
    }
  };

  const endDrag = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null;
      svgRef.current?.releasePointerCapture(e.pointerId);
    }
  };

  const W = scene.width;
  const H = scene.height;
  const fill = backgroundFill(scene, palette);
  const decor = scene.background.decor !== 'none' ? manifest.backdrops[scene.background.decor] : null;
  const selected = scene.items.find((it) => it.id === selectedId) ?? null;
  const selGeo = selected ? itemGeometry(manifest, scene.size, scene.scale, selected) : null;
  const titleZone = props.showTitleZone ? titleArea(W, H) : null;
  const px = (n: number) => n / unit;

  return (
    <svg
      ref={svgRef}
      className="stage-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || (e.target as Element).getAttribute('data-bg') === '1') props.onSelect(null);
      }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="application"
      aria-label={`Холст ${W} на ${H}`}
    >
      <defs>
        <pattern id="checker" width={px(16)} height={px(16)} patternUnits="userSpaceOnUse">
          <rect width={px(16)} height={px(16)} fill="#ffffff" />
          <rect width={px(8)} height={px(8)} fill="#e6e6e3" />
          <rect x={px(8)} y={px(8)} width={px(8)} height={px(8)} fill="#e6e6e3" />
        </pattern>
        <clipPath id="stage-clip">
          <rect width={W} height={H} />
        </clipPath>
      </defs>
      <rect data-bg="1" width={W} height={H} fill={fill ?? 'url(#checker)'} />
      {decor && (
        <g clipPath="url(#stage-clip)" pointerEvents="none">
          <g transform={decorTransform(scene, decor)} dangerouslySetInnerHTML={{ __html: fillTemplate(decor.body, palette, 'stage-decor') }} />
        </g>
      )}
      {titleZone && (
        <g pointerEvents="none" className="title-zone">
          <rect x={titleZone.x} y={titleZone.y} width={titleZone.w} height={titleZone.h} rx={px(6)} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(5)}`} />
          <text x={titleZone.x + px(14)} y={titleZone.y + px(26)} fontSize={px(13)}>
            Место под заголовок
          </text>
        </g>
      )}
      {pack &&
        scene.items.map((item) => (
          <ItemView
            key={item.id}
            item={item}
            transform={itemGeometry(manifest, scene.size, scene.scale, item).transform}
            markup={markupFor(item)}
            label={displayName(item.objId, item.variant)}
            onPointerDown={startMove}
          />
        ))}
      {/* Всё, что вышло за холст, видно, но приглушено: в экспорт попадёт только рамка. */}
      <path
        className="stage-outside"
        pointerEvents="none"
        fillRule="evenodd"
        d={`M${-20 * W} ${-20 * H}H${21 * W}V${21 * H}H${-20 * W}Z M0 0V${H}H${W}V0Z`}
      />
      <rect className="stage-frame" pointerEvents="none" width={W} height={H} fill="none" strokeWidth={px(1)} />
      {selected && selGeo && (
        <g className="selection" transform={`translate(${selected.x} ${selected.y}) rotate(${selected.rotation})`}>
          <rect
            x={-selGeo.w / 2}
            y={-selGeo.h / 2}
            width={selGeo.w}
            height={selGeo.h}
            fill="none"
            strokeWidth={px(1.5)}
            strokeDasharray={`${px(5)} ${px(4)}`}
            pointerEvents="none"
          />
          <line x1={0} y1={-selGeo.h / 2} x2={0} y2={-selGeo.h / 2 - px(26)} strokeWidth={px(1.5)} pointerEvents="none" />
          <circle
            className="rotate-handle"
            cx={0}
            cy={-selGeo.h / 2 - px(26)}
            r={px(8)}
            strokeWidth={px(2)}
            onPointerDown={(e) => startRotate(e, selected)}
          >
            <title>Повернуть. С Shift шагом 15°</title>
          </circle>
        </g>
      )}
    </svg>
  );
}

/** Где оставить место под заголовок: дополнение к области раскладки «под заголовок». */
function titleArea(W: number, H: number) {
  const r = layoutRegion('under-title', W, H);
  return W / H >= 1.15
    ? { x: 0.05 * W, y: 0.2 * H, w: r.x - 0.08 * W, h: 0.6 * H }
    : { x: 0.06 * W, y: 0.07 * H, w: 0.88 * W, h: r.y - 0.1 * H };
}
