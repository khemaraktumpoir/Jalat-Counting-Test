import { join } from 'path';

import { FrameSource, resolveFfmpeg } from '@lib/inference';

import { ColorDetector } from './color-detector';
import { CountingPipeline } from './pipeline';
import { Frame } from './types';

/**
 * The whole pipeline on test-videos/warehouse-zone-by-hand.mp4 (ffmpeg → demo detector → tracker →
 * zone), against the video's own script: a worker carries 9 orange parcels one by one from a pile
 * into the zone taped on the floor and leaves them there (in at about 5, 14, 25, 33, 40, 50, 59, 66
 * and 73 s): 9 parcels IN, none OUT, in 80 s. The worker (navy, dark gloves, white helmet) and the
 * brown stock are not orange: not counted.
 */
describe('sample video, end to end', () => {
  it('counts the 9 parcels carried into the zone', async () => {
    const pipeline = new CountingPipeline(new ColorDetector(), {
      conf: 0.4,
      labels: { 0: 'parcel' },
      // The zone taped on the floor (yarn db:seed's "Sample zone").
      region: {
        type: 'POLYGON',
        points: [
          { x: 440, y: 200 },
          { x: 880, y: 200 },
          { x: 880, y: 560 },
          { x: 440, y: 560 }
        ]
      }
    });
    const source = new FrameSource({
      url: join(__dirname, '../../../test-videos/warehouse-zone-by-hand.mp4'),
      fps: 10,
      width: 1280,
      height: 720,
      realtime: false,
      ffmpegPath: resolveFfmpeg(process.env.FFMPEG_PATH)
    });
    const frames: Frame[] = [];
    await new Promise<void>((resolve, reject) => {
      source.on('frame', (f: Frame) => frames.push(f));
      source.on('end', ({ error }: { error?: string }) =>
        error ? reject(new Error(error)) : resolve()
      );
      source.start();
    });
    expect(frames.length).toBeGreaterThanOrEqual(790);

    let last;
    for (const f of frames) last = await pipeline.process(f);
    expect(last!.in).toBe(9);
    expect(last!.out).toBe(0);
    expect(last!.byClass.parcel.in).toBe(9);
  }, 120_000);
});
