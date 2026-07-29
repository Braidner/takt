import React from 'react';
import { spring } from 'remotion';

/**
 * Визуальный язык врезок: вертикальная колонка слева от чата. Блоки всплывают снизу
 * вверх по одному, пока ассистент думает, — зрителю есть что читать, а чат остаётся
 * виден целиком и не требует наездов камеры.
 */

const FONT = 'ui-sans-serif, -apple-system, Inter, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export const TONE = {
  neutral: { border: 'rgba(255,255,255,.14)', bg: 'rgba(255,255,255,.05)', text: '#e8f0fb' },
  accent: { border: 'rgba(24,144,255,.55)', bg: 'rgba(24,144,255,.15)', text: '#cfe6ff' },
  good: { border: 'rgba(82,196,26,.5)', bg: 'rgba(82,196,26,.13)', text: '#d6f5c8' },
  warn: { border: 'rgba(250,173,20,.5)', bg: 'rgba(250,173,20,.13)', text: '#ffe7bd' },
} as const;

export type Tone = keyof typeof TONE;

/** Сколько кадров прошло с начала врезки — из этого блоки считают своё появление */
export const RevealContext = React.createContext({ elapsed: 0, fps: 30 });

/** Задержка между появлением соседних блоков */
const STAGGER_SEC = 0.95;

const useReveal = (index: number) => {
  const { elapsed, fps } = React.useContext(RevealContext);
  return spring({
    frame: elapsed - index * STAGGER_SEC * fps,
    fps,
    config: { damping: 200, mass: 0.6, stiffness: 90 },
  });
};

/**
 * Шаг схемы: номер, заголовок, пояснение. Всплывает снизу с лёгким сдвигом —
 * поэтому колонка читается как разворачивающийся во времени процесс, а не как статичная картинка.
 */
export const Step: React.FC<{
  index: number;
  n?: string;
  title: string;
  sub?: string;
  tone?: Tone;
  mono?: boolean;
}> = ({ index, n, title, sub, tone = 'neutral', mono }) => {
  const p = useReveal(index);
  const t = TONE[tone];

  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 46}px)`,
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        padding: '18px 20px',
        borderRadius: 16,
        border: `1px solid ${t.border}`,
        background: t.bg,
      }}
    >
      {n && (
        <span
          style={{
            flex: '0 0 38px',
            height: 38,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 11,
            background: 'rgba(255,255,255,.07)',
            color: t.text,
            fontSize: 20,
            fontWeight: 700,
            fontFamily: FONT,
          }}
        >
          {n}
        </span>
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ color: t.text, fontSize: 26, fontWeight: 650, fontFamily: mono ? MONO : FONT, lineHeight: 1.25 }}>
          {title}
        </div>
        {sub && (
          <div style={{ marginTop: 5, color: 'rgba(232,240,251,.62)', fontSize: 20, fontFamily: FONT, lineHeight: 1.35 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
};

/** Вывод врезки — появляется последним, после всех шагов */
export const Takeaway: React.FC<{ index: number; children: React.ReactNode }> = ({ index, children }) => {
  const p = useReveal(index);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 46}px)`,
        marginTop: 4,
        padding: '16px 20px',
        borderLeft: '3px solid rgba(24,144,255,.75)',
        background: 'rgba(255,255,255,.04)',
        borderRadius: '0 14px 14px 0',
        color: '#cfe6ff',
        fontSize: 21,
        fontFamily: FONT,
        lineHeight: 1.4,
      }}
    >
      {children}
    </div>
  );
};

/** Оболочка вертикальной врезки: заголовок появляется первым */
export const DiagramShell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const p = useReveal(0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          opacity: p,
          transform: `translateY(${(1 - p) * 30}px)`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 2,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#1890ff' }} />
        <span style={{ color: '#eaf2ff', fontSize: 30, fontWeight: 700, fontFamily: FONT }}>{title}</span>
      </div>
      {children}
    </div>
  );
};
