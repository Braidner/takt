import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

/** Заставка главы: заголовок и подзаголовок с лёгким выездом */
export const ChapterCard: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg,#0f1621 0%,#152033 55%,#0d1420 100%)',
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: 'ui-sans-serif, -apple-system, Inter, sans-serif',
      }}
    >
      <div style={{ transform: `translateY(${interpolate(p, [0, 1], [26, 0])}px)`, opacity: p, textAlign: 'center' }}>
        <div style={{ color: '#1890ff', fontSize: 26, letterSpacing: 6, textTransform: 'uppercase', marginBottom: 18 }}>
          {subtitle}
        </div>
        <div style={{ color: '#f2f7ff', fontSize: 82, fontWeight: 700 }}>{title}</div>
        <div
          style={{
            width: interpolate(p, [0, 1], [0, 220]),
            height: 4,
            background: '#1890ff',
            borderRadius: 2,
            margin: '34px auto 0',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
