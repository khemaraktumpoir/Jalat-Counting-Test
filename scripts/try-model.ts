/**
 * Runs a model through the whole counting pipeline on a video, as a camera would (ffmpeg frames →
 * detector → tracker → line), as fast as possible, and prints what it saw: detections per class,
 * IN / OUT per class, and the time a frame. Use it to check a model before setting MODEL_PATH —
 * e.g. that a trained parcel model finds the parcels on a recording of the belt.
 *
 *   yarn model:try                                        # models/yolo26n.onnx on the sample video
 *   yarn model:try models/parcel.onnx recordings/belt1.mp4 --line 0,360,1280,360 --conf 0.3
 *   yarn model:try demo:orange                            # the colour detector, for comparison
 *
 * --line x1,y1,x2,y2  the counting line in the 1280×720 picture (IN = to the left of a→b);
 *                     default: across the middle, drawn right → left (IN is downwards)
 * --conf 0.4          minimum score;  --classes 0,2  only these class ids
 */
import { existsSync } from 'fs';
import { resolve } from 'path';

import { C } from '@common';
import {
  ColorDetector,
  CountingPipeline,
  DEMO_MODEL,
  Detector,
  DetectorLike,
  Frame
} from '@lib/counting';
import { foldClasses, FrameSource, loadLabels, loadOnnxModel, resolveFfmpeg } from '@lib/inference';

const WIDTH = 1280;
const HEIGHT = 720;

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [modelArg, videoArg] = argv.filter(
    (a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))
  );
  const modelPath = modelArg || 'models/yolo26n.onnx';
  const video = resolve(videoArg || 'test-videos/warehouse-zone-by-hand.mp4');
  const [x1, y1, x2, y2] = (option(argv, 'line') ?? `${WIDTH * 0.75},360,${WIDTH * 0.25},360`)
    .split(',')
    .map(Number);
  const conf = Number(option(argv, 'conf') ?? 0.4);
  const classes = option(argv, 'classes')?.split(',').map(Number) ?? [];

  let detector: DetectorLike;
  let labels: Record<number, string>;
  if (modelPath === DEMO_MODEL) {
    detector = new ColorDetector();
    labels = { 0: 'parcel' };
  } else {
    const model = await loadOnnxModel(resolve(modelPath), 'cpu');
    const labelsPath = resolve(option(argv, 'labels') ?? 'models/classes.json');
    labels = existsSync(labelsPath) ? loadLabels(labelsPath) : {};
    // As the camera worker: classes sharing a label (the parcel model's words) count as one.
    detector = new Detector(model.infer, C.MODEL_INPUT_SIZE, foldClasses(labels));
  }

  // Every detection the model makes, per class (to see what it thinks the parcels are).
  const seen: Record<string, number> = {};
  const counting: DetectorLike = {
    detect: async (frame, options) => {
      const found = await detector.detect(frame, options);
      for (const d of found) {
        const label = labels[d.classId] ?? `class ${d.classId}`;
        seen[label] = (seen[label] ?? 0) + 1;
      }
      return found;
    }
  };
  const pipeline = new CountingPipeline(counting, {
    conf,
    classes,
    labels,
    region: {
      type: 'LINE',
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y2 }
      ]
    }
  });

  const frames: Frame[] = [];
  await new Promise<void>((done, fail) => {
    const source = new FrameSource({
      url: video,
      fps: 10,
      width: WIDTH,
      height: HEIGHT,
      realtime: false,
      ffmpegPath: resolveFfmpeg(process.env.FFMPEG_PATH)
    });
    source.on('frame', (f: Frame) => frames.push(f));
    source.on('end', ({ error }: { error?: string }) => (error ? fail(new Error(error)) : done()));
    source.start();
  });

  const start = process.hrtime.bigint();
  let last: Awaited<ReturnType<CountingPipeline['process']>> | undefined;
  for (const frame of frames) last = await pipeline.process(frame);
  const msPerFrame = Number(process.hrtime.bigint() - start) / 1e6 / Math.max(1, frames.length);

  console.log(`Model    ${modelPath}`);
  console.log(`Video    ${video} (${frames.length} frames at 10 fps)`);
  console.log(`Line     (${x1}, ${y1}) → (${x2}, ${y2}), conf ${conf}`);
  console.log(
    `Speed    ${msPerFrame.toFixed(1)} ms a frame (detect + track + count) → ${(
      1000 / msPerFrame
    ).toFixed(1)} fps`
  );
  const top = Object.entries(seen).sort((a, b) => b[1] - a[1]);
  console.log(
    `Detected ${top.length ? top.map(([label, n]) => `${label} ×${n}`).join(', ') : 'nothing'}`
  );
  console.log(`Counted  IN ${last?.in ?? 0}, OUT ${last?.out ?? 0}`);
  for (const [label, c] of Object.entries(last?.byClass ?? {}))
    console.log(`         ${label}: IN ${c.in}, OUT ${c.out}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
