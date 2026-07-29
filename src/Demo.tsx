import React from 'react';
import { AbsoluteFill } from 'remotion';
import { TransitionSeries, springTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { Scene } from './Scene';
import { ChapterCard } from './components/ChapterCard';
import { SCENES, TRANSITION_FRAMES } from './scenes';
import type { Timeline } from './lib/timeline';

export type DemoProps = {
  timelines: Timeline[];
};

const CHAPTER_FRAMES = 55;

export const Demo: React.FC<DemoProps> = ({ timelines }) => {
  if (!timelines?.length) {
    return (
      <AbsoluteFill style={{ background: '#0f1621', color: '#8fa3bf', fontSize: 40, justifyContent: 'center', alignItems: 'center' }}>
        Сначала снимите сцену: npm run capture
      </AbsoluteFill>
    );
  }

  return (
    <TransitionSeries>
      {timelines.flatMap((timeline, i) => {
        const meta = SCENES[i];
        const nodes = [
          <TransitionSeries.Sequence key={`${meta.id}-chapter`} durationInFrames={CHAPTER_FRAMES}>
            <ChapterCard title={meta.title} subtitle={meta.chapter} />
          </TransitionSeries.Sequence>,
          <TransitionSeries.Transition
            key={`${meta.id}-t-in`}
            presentation={slide({ direction: 'from-right' })}
            timing={springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES })}
          />,
          <TransitionSeries.Sequence key={meta.id} durationInFrames={Math.round(timeline.durationInSeconds * 60)}>
            <Scene timeline={timeline} title={meta.title} />
          </TransitionSeries.Sequence>,
        ];

        if (i < timelines.length - 1) {
          nodes.push(
            <TransitionSeries.Transition
              key={`${meta.id}-t-out`}
              presentation={slide({ direction: 'from-right' })}
              timing={springTiming({ config: { damping: 200 }, durationInFrames: TRANSITION_FRAMES })}
            />,
          );
        }
        return nodes;
      })}
    </TransitionSeries>
  );
};
