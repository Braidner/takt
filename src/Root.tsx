import React from 'react';
import { Composition, staticFile, type CalculateMetadataFunction } from 'remotion';
import { Demo, type DemoProps } from './Demo';
import { SCENES, TRANSITION_FRAMES } from './scenes';
import type { Timeline } from './lib/timeline';

const FPS = 60;
const CHAPTER_FRAMES = 55;

/**
 * Длительность ролика считается из телеметрии сцен, поэтому пересъёмка сцены
 * не требует правок кода — достаточно перезапустить Studio.
 */
const calculateMetadata: CalculateMetadataFunction<DemoProps> = async () => {
  const timelines: Timeline[] = [];
  for (const scene of SCENES) {
    const res = await fetch(staticFile(`timeline/${scene.id}.json`));
    if (!res.ok) continue;
    timelines.push((await res.json()) as Timeline);
  }

  const perScene = timelines.reduce(
    (acc, t) => acc + CHAPTER_FRAMES + Math.round(t.durationInSeconds * FPS),
    0,
  );
  const transitions = timelines.length === 0 ? 0 : (timelines.length * 2 - 1) * TRANSITION_FRAMES;

  return {
    durationInFrames: Math.max(60, perScene - transitions),
    props: { timelines },
  };
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Demo"
    component={Demo}
    durationInFrames={600}
    fps={FPS}
    width={1920}
    height={1080}
    defaultProps={{ timelines: [] }}
    calculateMetadata={calculateMetadata}
  />
);
