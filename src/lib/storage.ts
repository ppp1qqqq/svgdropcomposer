/**
 * Локальное сохранение черновика и своих палитр в браузере.
 * Хранилище может быть недоступно (приватное окно, запрет сайта),
 * поэтому любая ошибка просто означает «ничего не сохранено».
 */
const PREFIX = 'svg-drop-composer:';

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно - работаем без него */
  }
}
