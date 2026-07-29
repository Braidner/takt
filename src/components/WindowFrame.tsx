import React from 'react';
import { AbsoluteFill } from 'remotion';

/** Рамка окна в стиле macOS: скругление, тень, «светофор» — тот самый вид продуктового демо */
export const WindowFrame: React.FC<{ children: React.ReactNode; title: string }> = ({ children, title }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
    <div
      style={{
        position: 'relative',
        // ширина подобрана так, чтобы окно с тайтлбаром целиком влезало в кадр 1920x1080
        width: 1640,
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: '0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08)',
        background: '#1b1f27',
      }}
    >
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '0 16px',
          background: 'linear-gradient(#2b313c, #232830)',
          borderBottom: '1px solid rgba(255,255,255,.06)',
        }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />
        ))}
        <span
          style={{
            marginLeft: 18,
            color: 'rgba(255,255,255,.55)',
            fontSize: 17,
            fontFamily: 'ui-sans-serif, -apple-system, Inter, sans-serif',
          }}
        >
          {title}
        </span>
      </div>
      {/* overflow скрывает выезд контента за рамку при наезде камеры */}
      <div style={{ position: 'relative', aspectRatio: '1440 / 810', overflow: 'hidden' }}>{children}</div>
    </div>
  </AbsoluteFill>
);
