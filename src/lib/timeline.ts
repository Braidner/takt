import { interpolate, spring } from 'remotion';

export type EventKind = 'move' | 'click' | 'type' | 'wide' | 'caption' | 'diagram' | 'diagram-end';

export type TelemetryEvent = {
  t: number;
  kind: EventKind;
  x?: number;
  y?: number;
  zoom?: number;
  label?: string;
  /** id схемы-врезки (src/diagrams) */
  id?: string;
  /** 'side' — окно ужимается влево, схема справа; 'full' — схема на весь кадр */
  mode?: 'side' | 'full';
};

export type Timeline = {
  scene: string;
  fps: number;
  frames: number;
  durationInSeconds: number;
  viewport: { width: number; height: number };
  events: TelemetryEvent[];
};

/** Точки, по которым едет камера и курсор (клики/наведения/печать/общий план) */
const isSpatial = (e: TelemetryEvent) => e.x !== undefined && e.kind !== 'click';

/**
 * Положение камеры: наезд на последнюю целевую точку с пружинным замедлением.
 * Возвращает масштаб и точку трансформации в процентах.
 */
export const useCameraState = (events: TelemetryEvent[], frame: number, fps: number) => {
  const points = events.filter(isSpatial);
  const active = points.filter((e) => e.t * fps <= frame);
  const cur = active.at(-1);
  const prev = active.at(-2);

  if (!cur) return { zoom: 1, ox: 50, oy: 50 };

  const progress = spring({
    frame: frame - cur.t * fps,
    fps,
    config: { damping: 200, mass: 0.7, stiffness: 90 },
  });

  const from = { zoom: prev?.zoom ?? 1, x: prev?.x ?? 0.5, y: prev?.y ?? 0.5 };
  const to = { zoom: cur.zoom ?? 1, x: cur.x ?? 0.5, y: cur.y ?? 0.5 };

  return {
    zoom: interpolate(progress, [0, 1], [from.zoom, to.zoom]),
    ox: interpolate(progress, [0, 1], [from.x, to.x]) * 100,
    oy: interpolate(progress, [0, 1], [from.y, to.y]) * 100,
  };
};

/** Положение курсора: летит к следующей цели чуть быстрее камеры */
export const useCursorState = (events: TelemetryEvent[], frame: number, fps: number) => {
  const points = events.filter((e) => e.x !== undefined && e.kind !== 'caption' && e.kind !== 'wide');
  const active = points.filter((e) => e.t * fps <= frame);
  const cur = active.at(-1);
  const prev = active.at(-2);

  const lastClick = events
    .filter((e) => e.kind === 'click' && e.t * fps <= frame)
    .at(-1);
  const sinceClick = lastClick ? (frame - lastClick.t * fps) / fps : 999;

  if (!cur) return { x: 50, y: 55, ripple: 0, visible: false };

  const progress = spring({
    frame: frame - cur.t * fps,
    fps,
    config: { damping: 26, mass: 0.5, stiffness: 120 },
  });

  return {
    x: interpolate(progress, [0, 1], [(prev?.x ?? cur.x ?? 0.5) * 100, (cur.x ?? 0.5) * 100]),
    y: interpolate(progress, [0, 1], [(prev?.y ?? cur.y ?? 0.5) * 100, (cur.y ?? 0.5) * 100]),
    ripple: sinceClick >= 0 && sinceClick < 0.5 ? sinceClick / 0.5 : 0,
    visible: true,
  };
};

/**
 * Активная врезка-схема. Показывается от события `diagram` до парного `diagram-end`;
 * `t` в телеметрии — время съёмки, поэтому длительность совпадает с реальной паузой хода.
 */
export const useDiagram = (events: TelemetryEvent[], frame: number, fps: number) => {
  const started = events.filter((e) => e.kind === 'diagram' && e.t * fps <= frame).at(-1);
  if (!started) return null;

  const startFrame = started.t * fps;
  const ended = events.find((e) => e.kind === 'diagram-end' && e.t * fps > startFrame);
  const endFrame = ended ? ended.t * fps : startFrame + 12 * fps;
  if (frame > endFrame) return null;

  // Появление и уход — только у оверлея; видео под ним продолжает идти.
  const appear = interpolate(frame - startFrame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const fade = interpolate(endFrame - frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });

  return {
    id: started.id as string,
    mode: (started.mode ?? 'side') as 'side' | 'full',
    progress: Math.min(appear, fade),
    // кадров с начала врезки — по ним блоки колонки считают свою очередь появления
    elapsed: frame - startFrame,
  };
};

/** Актуальная подпись действия для нижней трети */
export const useCaption = (events: TelemetryEvent[], frame: number, fps: number) => {
  const labelled = events.filter((e) => e.label);
  const idx = labelled.map((e, i) => ({ e, i })).filter(({ e }) => e.t * fps <= frame).at(-1);
  if (!idx) return null;

  const next = labelled[idx.i + 1];
  const startFrame = idx.e.t * fps;
  const endFrame = next ? next.t * fps : startFrame + 4 * fps;
  if (frame > endFrame) return null;

  const appear = interpolate(frame - startFrame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const fade = interpolate(endFrame - frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  return { text: idx.e.label as string, opacity: Math.min(appear, fade) };
};
