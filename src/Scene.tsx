import React from 'react';
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { Video } from '@remotion/media';
import { Cursor } from './components/Cursor';
import { WindowFrame } from './components/WindowFrame';
import { DiagramOverlay } from './components/DiagramOverlay';
import { useCameraState, useCursorState, useCaption, useDiagram, type Timeline } from './lib/timeline';

export const Scene: React.FC<{ timeline: Timeline; title: string }> = ({ timeline, title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cam = useCameraState(timeline.events, frame, fps);
  const cur = useCursorState(timeline.events, frame, fps);
  const caption = useCaption(timeline.events, frame, fps);
  const diagram = useDiagram(timeline.events, frame, fps);

  // лёгкий вступительный наплыв, чтобы сцена не начиналась статикой
  const intro = interpolate(frame, [0, 18], [1.04, 1], { extrapolateRight: 'clamp' });

  // Врезка 'side' уводит окно влево и ужимает его: справа освобождается место под схему,
  // но запись продолжает идти — зритель видит, что ассистент работает, пока читает принцип.
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(135deg,#0f1621 0%,#152033 55%,#0d1420 100%)' }}>
      <AbsoluteFill>
        <WindowFrame title={title}>
          <AbsoluteFill
            style={{
              transform: `scale(${cam.zoom * intro})`,
              transformOrigin: `${cam.ox}% ${cam.oy}%`,
            }}
          >
            <Video src={staticFile(`clips/${timeline.scene}.mp4`)} style={{ width: '100%', height: '100%' }} />
            {cur.visible && <Cursor x={cur.x} y={cur.y} ripple={cur.ripple} zoom={cam.zoom} />}
          </AbsoluteFill>
        </WindowFrame>
      </AbsoluteFill>

      {diagram && (
        <DiagramOverlay id={diagram.id} elapsed={diagram.elapsed} fps={fps} progress={diagram.progress} />
      )}

      {caption && !diagram && (
        <div
          style={{
            position: 'absolute',
            left: 92,
            bottom: 92,
            opacity: caption.opacity,
            transform: `translateY(${(1 - caption.opacity) * 14}px)`,
            padding: '18px 30px',
            borderRadius: 14,
            background: 'rgba(9,14,22,.82)',
            border: '1px solid rgba(24,144,255,.35)',
            boxShadow: '0 18px 50px rgba(0,0,0,.5)',
            color: '#eaf2ff',
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: 0.2,
            fontFamily: 'ui-sans-serif, -apple-system, Inter, sans-serif',
          }}
        >
          <span style={{ color: '#1890ff', marginRight: 14 }}>▎</span>
          {caption.text}
        </div>
      )}
    </AbsoluteFill>
  );
};
