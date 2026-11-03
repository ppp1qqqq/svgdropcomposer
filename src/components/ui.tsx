import type { ReactNode } from 'react';

const PATHS: Record<string, string> = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  top: 'M6 5h12M6 17l6-6 6 6',
  bottom: 'M6 19h12M6 7l6 6 6-6',
  rotl: 'M4 4v6h6M4.6 15a8 8 0 1 0 1.9-8.3L4 10',
  rotr: 'M20 4v6h-6M19.4 15a8 8 0 1 1-1.9-8.3L20 10',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  clipboard: 'M9 4h6v3H9zM8 5H6v15h12V5h-2',
  shuffle: 'M4 7h3c4 0 6 10 10 10h3M4 17h3c1.6 0 2.8-1.6 3.8-3.5M14 9.5C15 8 16.2 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  plus: 'M12 5v14M5 12h14',
  reset: 'M12 4a8 8 0 1 1-8 8',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
};

export function Icon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="icon">
      <path d={PATHS[name] ?? ''} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-on' : ''}
          title={o.hint}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="section" aria-labelledby={id}>
      <header className="section-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  kbd,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  kbd?: string;
}) {
  return (
    <button type="button" className="icon-btn" onClick={onClick} disabled={disabled} title={kbd ? `${label} (${kbd})` : label} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}
