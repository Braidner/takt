/**
 * Образец: панорама по снимку вместо записи прокрутки.
 *
 * Источник — один снимок страницы целиком, 2880×8278, снятый за 224 мс. Прокрутка,
 * наезд и удержание синтезируются: кадр вычисляется из своего номера, а не ловится в
 * реальном времени. Поэтому дропнутых кадров не существует по построению, а резкость
 * ограничена только исходником — а он вдвое плотнее кадра.
 */
import React from 'react';
import {
  AbsoluteFill, Composition, registerRoot, useCurrentFrame, useVideoConfig,
  interpolate, spring, staticFile, delayRender, continueRender, Easing,
} from 'remotion';

const W = 1920, H = 1080, FPS = 30, DUR = 20;

/** Снимок: ширина совпадает с шириной вьюпорта в 2×, высота — вся страница. */
const SHOT = { w: 2880, h: 8278 };
const VIEW = { w: 2880, h: 1620 };          // окно в координатах снимка
const MAX_PAN = SHOT.h - VIEW.h;

const DISPLAY = "'Unbounded', system-ui, sans-serif";
const BODY = "'Golos Text', system-ui, sans-serif";

const useFonts = () => {
  const [h] = React.useState(() => delayRender('шрифты'));
  React.useEffect(() => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@600;800'
      + '&family=Golos+Text:wght@400;500;600&display=swap';
    document.head.appendChild(l);
    document.fonts.ready.then(() => continueRender(h));
  }, [h]);
};

/** Раскадровка образца: что происходит и когда. Всё — функция от секунды. */
const PLAN = [
  { at: 0.0, text: 'Ваша медиатека' },
  { at: 4.2, text: 'Прокрутка собрана, а не снята' },
  { at: 11.0, text: 'Наезд без потери резкости' },
  { at: 16.4, text: 'Ни одного потерянного кадра' },
];

const Pan: React.FC = () => {
  useFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  // Панорама: разгон и торможение, как у настоящего проезда камеры.
  const pan = interpolate(t, [4.2, 10.6], [0, MAX_PAN * 0.62], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.bezier(0.45, 0, 0.25, 1),
  });

  // Вступительный наплыв и наезд на карточку — тот запас плотности, ради которого 2×.
  const intro = interpolate(t, [0, 2.6], [1.045, 1], { extrapolateRight: 'clamp' });
  const zoomIn = spring({ frame: frame - 11.0 * fps, fps, config: { damping: 200, stiffness: 60 } });
  const zoomOut = interpolate(t, [15.4, 16.6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const zoom = 1 + 0.55 * zoomIn * zoomOut;
  const ox = interpolate(zoomIn * zoomOut, [0, 1], [50, 30]);
  const oy = interpolate(zoomIn * zoomOut, [0, 1], [50, 62]);

  const cap = PLAN.filter((p) => p.at <= t).pop();
  const capIn = cap ? spring({ frame: frame - cap.at * fps, fps, config: { damping: 200, stiffness: 90 } }) : 0;

  return (
    <AbsoluteFill style={{
      background: 'radial-gradient(72% 92% at 78% 4%, #14335f, transparent 62%),'
        + 'radial-gradient(60% 80% at 8% 98%, #0d3b34, transparent 60%),'
        + 'linear-gradient(158deg,#0b1120,#070a11 72%)',
    }}>
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 54 }}>
        <div style={{
          width: 1330, borderRadius: 14, overflow: 'hidden', background: '#12161d',
          boxShadow: '0 60px 120px -22px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.07),'
            + '0 0 160px -50px rgba(1,98,228,.5)',
        }}>
          <div style={{
            height: 40, display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px',
            background: 'linear-gradient(#242a34,#1b2029)',
          }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />
            ))}
            <span style={{ marginLeft: 18, color: 'rgba(255,255,255,.45)', font: `500 15px ${BODY}` }}>
              Mission Control — библиотека
            </span>
          </div>

          {/* Окно в снимок: сам снимок едет, рамка стоит. */}
          <div style={{ position: 'relative', aspectRatio: `${VIEW.w} / ${VIEW.h}`, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', inset: 0,
              transform: `scale(${zoom * intro})`,
              transformOrigin: `${ox}% ${oy}%`,
            }}>
              <img
                src={staticFile('mc-page.jpg')}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  // Проценты от собственной высоты: снимок в восемь раз выше окна.
                  transform: `translateY(${-(pan / SHOT.h) * 100}%)`,
                }}
              />
            </div>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{
        pointerEvents: 'none',
        background: 'radial-gradient(118% 90% at 50% 42%, transparent 54%, rgba(0,0,0,.5))',
      }} />

      {cap && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 58, textAlign: 'center', padding: '0 140px' }}>
          <div style={{ overflow: 'hidden', paddingBottom: 12 }}>
            <div style={{
              font: `800 50px/1.1 ${DISPLAY}`, color: '#fff', letterSpacing: '-.035em',
              textShadow: '0 12px 48px rgba(0,0,0,.9)',
              transform: `translateY(${interpolate(capIn, [0, 1], [110, 0])}%)`,
            }}>{cap.text}</div>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <Composition id="Pan" component={Pan} durationInFrames={DUR * FPS} fps={FPS} width={W} height={H} />
);

registerRoot(Root);
