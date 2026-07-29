import React from 'react';
import { AbsoluteFill } from 'remotion';
import { DIAGRAMS } from '../diagrams';
import { RevealContext } from '../diagrams/kit';

/**
 * Врезка-схема: вертикальная колонка в ЛЕВОЙ части кадра. Панель ассистента живёт справа,
 * поэтому схема ничего не закрывает — чат остаётся виден целиком и его не нужно приближать.
 * Блоки всплывают по одному (см. kit.Step), пока идёт длинный ход.
 */
export const DiagramOverlay: React.FC<{
  id: string;
  elapsed: number;
  fps: number;
  progress: number;
}> = ({ id, elapsed, fps, progress }) => {
  const Diagram = DIAGRAMS[id];
  if (!Diagram) return null;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: progress }}>
      {/* мягкое затемнение только под колонкой — чтобы текст схемы не спорил с интерфейсом */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 900,
          background: 'linear-gradient(90deg, rgba(8,12,20,.93) 0%, rgba(8,12,20,.86) 62%, rgba(8,12,20,0) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 96,
          top: 0,
          bottom: 0,
          width: 660,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <RevealContext.Provider value={{ elapsed, fps }}>
          <Diagram />
        </RevealContext.Provider>
      </div>
    </AbsoluteFill>
  );
};
