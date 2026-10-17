import { join } from 'path';

import { FrameSource, resolveFfmpeg } from '@lib/inference';

import { ColorDetector } from './color-detector';
import { CountingPipeline } from './pipeline';
import { Frame } from './types';

/**
 * The whole pipeline on samples/conveyor-synthetic.mp4 (ffmpeg → demo detector → tracker → line),
 * against a count made by hand from the video's own formula: two boxes move down the belt at
 * 150 px/s on a 900 px cycle; their centers cross y = 360 at t ≈ 3.2, 9.2, 15.2 s (the big one)
 * and t ≈ 0.2, 6.2, 12.2, 18.2 s (the small one): 7 parcels IN, none OUT, in 20 s.
 */
describe('sample video, end to end', () => {
  it('counts the 7 parcels crossing the line', async () => {
    const frame = (f: Frame) => f;
    const pipeline = new CountingPipeline(new ColorDetector(), {
      conf: 0.4,
      labels: { 0: 'parcel' },
      // Across the belt, drawn right → left: IN is downwards.
      region: {
        type: 'LINE',
        points: [
          { x: 960, y: 360 },
          { x: 320, y: 360 }
        ]
      }
    });
    const source = new FrameSource({
      url: join(__dirname, '../../../samples/conveyor-synthetic.mp4'),
      fps: 10,
      width: 1280,
      height: 720,
      realtime: false,
      ffmpegPath: resolveFfmpeg(process.env.FFMPEG_PATH)
    });
    const frames: Frame[] = [];
    await new Promise<void>((resolve, reject) => {
      source.on('frame', (f: Frame) => frames.push(frame(f)));
      source.on('end', ({ error }: { error?: string }) =>
        error ? reject(new Error(error)) : resolve()
      );
      source.start();
    });
    expect(frames.length).toBeGreaterThanOrEqual(195);

    let last;
    for (const f of frames) last = await pipeline.process(f);
    // Within one of the hand count (a crossing in the last frames may not have been seen yet).
    expect(Math.abs(last!.in - 7)).toBeLessThanOrEqual(1);
    expect(last!.out).toBe(0);
    expect(last!.byClass.parcel.in).toBe(last!.in);
  }, 60_000);
});
