export type SizeId = 'L' | 'S';
export type Variant = 'main' | 'bg';
export type ObjectId =
  | 'book'
  | 'phone'
  | 'puzzle'
  | 'coin'
  | 'headphones'
  | 'lamp'
  | 'flowers'
  | 'wallet'
  | 'folder'
  | 'pen';

/** Роли палитры: три цвета фона, три цвета объектов, контур и белый. */
export type RoleId = 'bg1' | 'bg2' | 'bg3' | 'ink' | 'obj1' | 'obj2' | 'obj3' | 'paper';

export interface Palette {
  id: string;
  name: string;
  colors: Record<RoleId, string>;
  builtIn?: boolean;
  /** Роли, которые сервис вычислил сам, когда в загруженной палитре их не было. */
  derived?: RoleId[];
}

export type LayoutMode = 'assembled' | 'under-title' | 'offset';

export interface SceneItem {
  id: string;
  objId: ObjectId;
  variant: Variant;
  /** Центр объекта в координатах холста. */
  x: number;
  y: number;
  /** Поворот в градусах вокруг центра. */
  rotation: number;
}

export interface Scene {
  width: number;
  height: number;
  formatId: string;
  size: SizeId;
  paletteId: string;
  background: { role: 'bg1' | 'bg2' | 'none'; decor: 'none' | 'strokes' | 'diagonal' };
  /** Пикселей холста на единицу канонического размера. Общий для всех объектов. */
  scale: number;
  /** Порядок массива = порядок слоёв, снизу вверх. */
  items: SceneItem[];
  mode: LayoutMode;
  seed: number;
}

export interface Mask {
  cols: number;
  rows: number;
  bits: Uint8Array;
}

export interface AssetMeta {
  w: number;
  h: number;
  roles: RoleId[];
  mask: Mask;
}

export interface AssetTemplate {
  w: number;
  h: number;
  body: string;
}

export interface LibraryManifest {
  sizes: Record<SizeId, Record<ObjectId, Record<Variant, AssetMeta>>>;
  backdrops: Record<'strokes' | 'diagonal', AssetTemplate>;
}

export type SizePack = Record<ObjectId, Record<Variant, AssetTemplate>>;
