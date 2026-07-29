import React from 'react';

/**
 * Курсор рисуется поверх записи по телеметрии — системный курсор нам не нужен.
 * Масштаб компенсирует наезд камеры, чтобы иконка не раздувалась вместе с UI.
 */
export const Cursor: React.FC<{ x: number; y: number; ripple: number; zoom: number }> = ({
  x,
  y,
  ripple,
  zoom,
}) => (
  <div
    style={{
      position: 'absolute',
      left: `${x}%`,
      top: `${y}%`,
      transform: `translate(-6%, -6%) scale(${1 / zoom})`,
      transformOrigin: 'top left',
      pointerEvents: 'none',
    }}
  >
    {ripple > 0 && (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 84,
          height: 84,
          marginLeft: -42,
          marginTop: -42,
          borderRadius: '50%',
          border: '3px solid rgba(24,144,255,0.9)',
          transform: `scale(${0.25 + ripple * 1.1})`,
          opacity: 1 - ripple,
        }}
      />
    )}
    <svg width="34" height="34" viewBox="0 0 24 24" style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' }}>
      <path d="M5 2 L5 20 L9.5 15.5 L12.5 22 L15.5 20.5 L12.5 14.5 L19 14.5 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  </div>
);
