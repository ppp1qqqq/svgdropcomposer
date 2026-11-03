import type { Palette, RoleId } from '../types';

/** Три схемы из Figma: плашки «Цвета фона» и «Цвета объектов». */
export const PRESET_PALETTES: Palette[] = [
  {
    id: 'lavender',
    name: 'Сиреневая',
    builtIn: true,
    colors: {
      bg1: '#D7CDF5', bg2: '#AA9BF0', bg3: '#7864D7', ink: '#181817',
      obj1: '#F9ECB0', obj2: '#F9A3AA', obj3: '#FFE3E1', paper: '#FFFFFF',
    },
  },
  {
    id: 'peach',
    name: 'Персиковая',
    builtIn: true,
    colors: {
      bg1: '#FDD7B9', bg2: '#FAC896', bg3: '#D27532', ink: '#181817',
      obj1: '#F9ECB0', obj2: '#80DADA', obj3: '#BEEBEB', paper: '#FFFFFF',
    },
  },
  {
    id: 'mint',
    name: 'Мятная',
    builtIn: true,
    colors: {
      bg1: '#BEEBEB', bg2: '#80DADA', bg3: '#5ABEBE', ink: '#181817',
      obj1: '#FFD4F2', obj2: '#6D7BFC', obj3: '#B6C6FE', paper: '#FFFFFF',
    },
  },
];

/** Палитра, в которой нарисованы исходники. Перекраска идёт от неё по ролям. */
export const SOURCE_PALETTE_ID = 'lavender';

export const ROLE_INFO: Record<RoleId, { label: string; group: 'bg' | 'obj' | 'base'; hint: string }> = {
  bg1: { label: 'Фон 1', group: 'bg', hint: 'Основной фон и заливка фоновых объектов' },
  bg2: { label: 'Фон 2', group: 'bg', hint: 'Второй тон фона, детали' },
  bg3: { label: 'Фон 3', group: 'bg', hint: 'Контуры и тени фоновых объектов, корпус телефона' },
  obj1: { label: 'Объект 1', group: 'obj', hint: 'Главный акцент объектов' },
  obj2: { label: 'Объект 2', group: 'obj', hint: 'Второй акцент: закладка, абажур, пазл' },
  obj3: { label: 'Объект 3', group: 'obj', hint: 'Светлый оттенок акцента: срез страниц' },
  ink: { label: 'Контур', group: 'base', hint: 'Линии и тени главных объектов' },
  paper: { label: 'Белый', group: 'base', hint: 'Белые плоскости объектов' },
};

export const ROLE_ORDER: RoleId[] = ['bg1', 'bg2', 'bg3', 'obj1', 'obj2', 'obj3', 'ink', 'paper'];
