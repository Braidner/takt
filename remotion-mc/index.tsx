/**
 * Монтаж mc-медиа средствами Remotion — для прямого сравнения с ffmpeg-сборкой.
 *
 * Источник тот же дубль. Отличается только слой композиции: здесь мокап-рамка, пружинная
 * камера, курсор с волной и титры с анимацией входа — то, что в ffmpeg делается
 * выражениями в строках и отлаживается по готовому файлу.
 */
import React from 'react';
import {
  AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig,
  interpolate, spring, staticFile, delayRender, continueRender, Sequence,
} from 'remotion';
import { OffthreadVideo } from 'remotion';
import props from './props.json';

const W = 1920, H = 1080, FPS = 30;
const SLATE = 2.4, TAIL = 2.2;

/** Шрифты грузим через delayRender: без него кадр снимется системным начертанием. */
const useBrandFonts = () => {
  const [handle] = React.useState(() => delayRender('шрифты'));
  React.useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800'
      + '&family=Golos+Text:wght@400;500;600&display=swap';
    document.head.appendChild(link);
    document.fonts.ready.then(() => continueRender(handle));
  }, [handle]);
};

const DISPLAY = "'Unbounded', system-ui, sans-serif";
const BODY = "'Golos Text', system-ui, sans-serif";

type Hit = { t: number; x: number; y: number; w: number; h: number };
type Cap = { t: number; text: string };

/** Работа камеры: подъезд к точке действия и возврат на общий план. */
const useCamera = (hits: Hit[], vp: { width: number; height: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const LEAD = 0.8, HOLD = 1.8, ZOOM = 1.24;
  const active = hits.find((h) => t >= h.t - LEAD && t <= h.t + HOLD);
  if (!active) return { zoom: 1, ox: 50, oy: 50 };

  // Пружина, а не линейная интерполяция: наезд должен затормозить, а не упереться.
  const inP = spring({ frame: frame - (active.t - LEAD) * fps, fps,
    config: { damping: 200, mass: 0.9, stiffness: 70 } });
  const outP = t > active.t + HOLD - 0.6
    ? interpolate(t, [active.t + HOLD - 0.6, active.t + HOLD], [1, 0], { extrapolateRight: 'clamp' })
    : 1;
  const p = inP * outP;

  // Центр притягиваем к середине: наезд ровно на точку выбрасывает из кадра контекст.
  const pull = 0.45;
  const nx = Math.max(0.24, Math.min(0.76, 0.5 + (active.x / vp.width - 0.5) * pull));
  const ny = Math.max(0.26, Math.min(0.74, 0.5 + (active.y / vp.height - 0.5) * pull));
  return {
    zoom: interpolate(p, [0, 1], [1, ZOOM]),
    ox: interpolate(p, [0, 1], [50, nx * 100]),
    oy: interpolate(p, [0, 1], [50, ny * 100]),
  };
};

const Cursor: React.FC<{ hits: Hit[]; vp: { width: number; height: number } }> = ({ hits, vp }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const h = hits.find((x) => t >= x.t - 0.7 && t <= x.t + 1.0);
  if (!h) return null;

  const prev = hits[hits.indexOf(h) - 1];
  // Курсор летит по траектории от прошлой цели, а не возникает в точке.
  const travel = spring({ frame: frame - (h.t - 0.7) * fps, fps,
    config: { damping: 26, mass: 0.6, stiffness: 110 } });
  const fromX = prev ? prev.x / vp.width : 0.5;
  const fromY = prev ? prev.y / vp.height : 0.55;
  const x = interpolate(travel, [0, 1], [fromX, h.x / vp.width]) * 100;
  const y = interpolate(travel, [0, 1], [fromY, h.y / vp.height]) * 100;

  const since = t - h.t;
  const ripple = since >= 0 && since < 0.55 ? since / 0.55 : -1;

  return (
    <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%` }}>
      {ripple >= 0 && (
        <div style={{
          position: 'absolute', left: -45, top: -45, width: 90, height: 90, borderRadius: '50%',
          border: '3px solid rgba(120,190,255,.9)',
          transform: `scale(${0.25 + ripple * 1.1})`, opacity: 1 - ripple,
        }} />
      )}
      <svg width="38" height="38" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.55))' }}>
        <path d="M5 2 L5 20 L9.5 15.5 L12.5 22 L15.5 20.5 L12.5 14.5 L19 14.5 Z"
              fill="#fff" stroke="#0b0e14" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Caption: React.FC<{ caps: Cap[]; total: number }> = ({ caps, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const i = caps.map((c, n) => ({ c, n })).filter(({ c }) => c.t <= t).pop();
  if (!i) return null;
  const next = caps[i.n + 1];
  const end = next ? next.t : total;
  if (t > end) return null;

  // Вход маской снизу вверх, а не растворением: титр должен появляться, а не проступать.
  const inP = spring({ frame: frame - i.c.t * fps, fps, config: { damping: 200, stiffness: 90 } });
  const outP = interpolate(t, [end - 0.4, end], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 78, textAlign: 'center',
      opacity: outP, padding: '0 120px',
    }}>
      <div style={{ overflow: 'hidden', paddingBottom: 10 }}>
        <div style={{
          font: `800 62px/1.06 ${DISPLAY}`, color: '#fff', letterSpacing: '-.035em',
          textShadow: '0 12px 48px rgba(0,0,0,.9)',
          transform: `translateY(${interpolate(inP, [0, 1], [110, 0])}%)`,
        }}>{i.c.text}</div>
      </div>
    </div>
  );
};

const Frame: React.FC = () => {
  useBrandFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const vp = props.viewport;
  const cam = useCamera(props.hits as Hit[], vp);

  // Лёгкий наплыв в начале плана: статичный старт читается как стоп-кадр.
  const intro = interpolate(frame, [0, 24], [1.035, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(72% 92% at 78% 4%, #14335f, transparent 62%),'
        + 'radial-gradient(60% 80% at 8% 98%, #0d3b34, transparent 60%),'
        + 'linear-gradient(158deg,#0b1120,#070a11 72%)',
    }}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          width: 1560, borderRadius: 16, overflow: 'hidden', background: '#12161d',
          boxShadow: '0 60px 120px -22px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.07),'
            + '0 0 160px -50px rgba(1,98,228,.5)',
        }}>
          <div style={{
            height: 40, display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px',
            background: 'linear-gradient(#242a34,#1b2029)',
            borderBottom: '1px solid rgba(255,255,255,.05)',
          }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
            ))}
            <span style={{ marginLeft: 18, color: 'rgba(255,255,255,.45)', font: `500 15px ${BODY}` }}>
              {props.title}
            </span>
          </div>
          <div style={{ position: 'relative', aspectRatio: `${vp.width} / ${vp.height}`, overflow: 'hidden' }}>
            <div style={{
              width: '100%', height: '100%',
              transform: `scale(${cam.zoom * intro})`,
              transformOrigin: `${cam.ox}% ${cam.oy}%`,
            }}>
              <OffthreadVideo src={staticFile(props.video)}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <Cursor hits={props.hits as Hit[]} vp={vp} />
            </div>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{
        pointerEvents: 'none',
        background: 'radial-gradient(118% 90% at 50% 42%, transparent 54%, rgba(0,0,0,.5))',
      }} />
      <Caption caps={props.captions as Cap[]} total={props.durationInSeconds} />
    </AbsoluteFill>
  );
};

const Card: React.FC<{ big: string; small?: string }> = ({ big, small }) => {
  useBrandFonts();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const inP = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0],
    { extrapolateLeft: 'clamp' });
  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(70% 90% at 50% 30%, #14335f, transparent 60%), #070a11',
      justifyContent: 'center', alignItems: 'center', textAlign: 'center', opacity: out,
    }}>
      <div style={{ transform: `translateY(${interpolate(inP, [0, 1], [26, 0])}px)`, opacity: inP }}>
        <div style={{ font: `800 92px/1.04 ${DISPLAY}`, color: '#fff', letterSpacing: '-.04em' }}>{big}</div>
        {small && <div style={{ marginTop: 22, font: `500 32px ${BODY}`, color: 'rgba(255,255,255,.6)' }}>{small}</div>}
        <div style={{
          width: 130, height: 3, margin: '26px auto 0', borderRadius: 2,
          background: 'linear-gradient(96deg,#0162e4,#089efb 45%,#00e0b8)',
          transform: `scaleX(${inP})`,
        }} />
      </div>
    </AbsoluteFill>
  );
};

const Movie: React.FC = () => {
  const body = Math.round(props.durationInSeconds * FPS);
  return (
    <AbsoluteFill style={{ background: '#070a11' }}>
      <Sequence durationInFrames={Math.round(SLATE * FPS)}>
        <Card big={props.title} />
      </Sequence>
      <Sequence from={Math.round(SLATE * FPS)} durationInFrames={body}>
        <Frame />
      </Sequence>
      <Sequence from={Math.round(SLATE * FPS) + body} durationInFrames={Math.round(TAIL * FPS)}>
        <Card big="Готово" small={props.endUrl} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <Composition
    id="McMovie"
    component={Movie}
    durationInFrames={Math.round((SLATE + props.durationInSeconds + TAIL) * FPS)}
    fps={FPS}
    width={W}
    height={H}
  />
);

registerRoot(Root);
