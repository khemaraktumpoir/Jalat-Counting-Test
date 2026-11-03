/**
 * Makes a test video's counted copy (test-videos/x-counted.mp4 next to x.mp4), the camera page's
 * "Counted" tab: the video counted as its camera counts it (the same frames, detector, tracker and
 * line or area: CountingPipeline), with the tracked boxes, the region and the running IN / OUT /
 * IN AREA drawn on it. The camera's settings come from its test-videos/cameras.json entry.
 *
 *   yarn video:count test-videos/chair-basket-zone.mp4
 *   yarn video:count test-videos/real-parcels-lane.mp4 --model models/parcel-cam.onnx
 *
 * --model <path|demo:orange>  the detector (default: the entry's model, else MODEL_PATH in .env)
 * --labels <classes.json>     its labels (default: MODEL_CLASSES_PATH, or <model>.classes.json)
 * --conf 0.4                  minimum score (default: the entry's confThreshold)
 */
import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { C } from '@common';
import {
  ColorDetector,
  CountingPipeline,
  DEMO_MODEL,
  Detector,
  DetectorLike,
  Frame,
  isParcelModel,
  RegionShape
} from '@lib/counting';
import { drawBox } from '@lib/counting/draw';
import { foldClasses, loadLabels, loadOnnxModel, resolveFfmpeg } from '@lib/inference';

interface Entry {
  name: string;
  sourceUrl?: string;
  fps: number;
  confThreshold: number;
  width: number;
  height: number;
  model?: string | null;
  region?: RegionShape;
}

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** KEY=value lines of .env (no quotes), for MODEL_PATH / MODEL_CLASSES_PATH. */
function dotenv(): Record<string, string> {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(
    readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .map(line => /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/.exec(line))
      .filter((m): m is RegExpExecArray => !!m && !!m[2].trim())
      .map(m => [m[1], m[2].trim()])
  );
}

/** Raw rgb24 frames of a video, decoded as the camera worker does (FrameSource), one at a time. */
async function* frames(ffmpeg: string, video: string, entry: Entry): AsyncGenerator<Frame> {
  const { width, height, fps } = entry;
  const size = width * height * 3;
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      video,
      '-an',
      '-vf',
      `fps=${fps},scale=${width}:${height}`,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1'
    ],
    { windowsHide: true }
  );
  let buffer = Buffer.alloc(0);
  for await (const chunk of child.stdout) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    while (buffer.length >= size) {
      yield { data: new Uint8Array(buffer.subarray(0, size)), width, height };
      buffer = buffer.subarray(size);
    }
  }
}

/** "0:00:01.20" for ASS. */
const assTime = (s: number) => {
  const cs = Math.round(s * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(
    cs % 100
  ).padStart(2, '0')}`;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const videoArg = argv.find(
    (a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))
  );
  if (!videoArg)
    throw new Error('Which video? e.g. yarn video:count test-videos/chair-basket-zone.mp4');
  const sourceUrl = videoArg.replace(/\\/g, '/').replace(/^\.\//, '');
  const entries: Entry[] = JSON.parse(readFileSync('test-videos/cameras.json', 'utf8'));
  const entry = entries.find(e => e.sourceUrl === sourceUrl);
  if (!entry?.region)
    throw new Error(`${sourceUrl}: no entry with a region in test-videos/cameras.json.`);
  const env = { ...dotenv(), ...process.env };
  const modelPath = option(argv, 'model') ?? entry.model ?? env.MODEL_PATH;
  if (!modelPath) throw new Error('No model: give --model, or set MODEL_PATH in .env.');
  const conf = Number(option(argv, 'conf') ?? entry.confThreshold);

  let detector: DetectorLike;
  let labels: Record<number, string>;
  if (modelPath === DEMO_MODEL) {
    detector = new ColorDetector();
    labels = { 0: 'parcel' };
  } else {
    const model = await loadOnnxModel(resolve(modelPath), 'cpu');
    const own = modelPath.replace(/\.onnx$/i, '.classes.json');
    const labelsPath =
      option(argv, 'labels') ??
      (existsSync(own) ? own : env.MODEL_CLASSES_PATH ?? 'models/classes.json');
    labels = existsSync(labelsPath) ? loadLabels(resolve(labelsPath)) : {};
    detector = new Detector(model.infer, C.MODEL_INPUT_SIZE, foldClasses(labels));
  }
  // As the camera worker: the parcel model's boxes tidied before tracking.
  const pipeline = new CountingPipeline(detector, {
    conf,
    classes: [],
    labels,
    region: entry.region,
    tidy: modelPath !== DEMO_MODEL && isParcelModel(labels)
  });

  const ffmpeg = resolveFfmpeg(process.env.FFMPEG_PATH);
  const out = resolve(sourceUrl.replace(/(\.[a-z0-9]+)$/i, '-counted$1'));
  const work = mkdtempSync(join(tmpdir(), 'count-video-'));
  const encoder = spawn(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${entry.width}x${entry.height}`, '-r', String(entry.fps), '-i', 'pipe:0',
     '-vf', 'ass=counts.ass', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'out.mp4'],
    { cwd: work, windowsHide: true }
  ); // prettier-ignore

  // Counted once to know the numbers frame by frame (the subtitle file must exist before encoding),
  // then drawn: the boxes on each frame as it is encoded.
  const results: {
    boxes: { x1: number; y1: number; x2: number; y2: number }[];
    in: number;
    out: number;
  }[] = [];
  const video = resolve(sourceUrl);
  for await (const frame of frames(ffmpeg, video, entry)) {
    const r = await pipeline.process(frame);
    results.push({ boxes: r.tracks.map(t => t.box), in: r.in, out: r.out });
  }
  const line = (from: number, to: number, r: { in: number; out: number }) => {
    const inArea = Math.max(0, r.in - r.out);
    const third = entry.region!.type === 'POLYGON' ? `   IN AREA ${inArea}` : '';
    return `Dialogue: 0,${assTime(from / entry.fps)},${assTime(to / entry.fps)},Counts,,0,0,0,,IN ${
      r.in
    }   OUT ${r.out}${third}`;
  };
  const events: string[] = [];
  for (let i = 0, start = 0; i <= results.length; i++) {
    const changed =
      i === results.length ||
      results[i].in !== results[start].in ||
      results[i].out !== results[start].out;
    if (changed && i > start) {
      events.push(line(start, i, results[start]));
      start = i;
    }
  }
  writeFileSync(
    join(work, 'counts.ass'),
    [
      '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${entry.width}`, `PlayResY: ${entry.height}`, '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV',
      'Style: Counts,Arial,40,&H00FFFFFF,&H00000000,&H90000000,1,3,10,0,7,24,24,20', '',
      '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      ...events
    ].join('\n')
  ); // prettier-ignore

  let k = 0;
  const drawer = new CountingPipeline(detector, {
    conf,
    classes: [],
    labels,
    region: entry.region
  });
  for await (const frame of frames(ffmpeg, video, entry)) {
    drawer.annotate(frame, []);
    for (const box of results[k]?.boxes ?? []) drawBox(frame, box, [0, 230, 255], 3);
    k++;
    if (
      !encoder.stdin.write(
        Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
      )
    )
      await new Promise(done => encoder.stdin.once('drain', done));
  }
  encoder.stdin.end();
  const code = await new Promise<number>(done => encoder.on('close', done));
  if (code !== 0) throw new Error(`ffmpeg stopped (${code}).`);
  writeFileSync(out, readFileSync(join(work, 'out.mp4')));
  rmSync(work, { recursive: true, force: true });

  const last = results[results.length - 1];
  console.log(`Model    ${modelPath} (conf ${conf})`);
  console.log(`Video    ${video} (${results.length} frames at ${entry.fps} fps)`);
  console.log(
    `Counted  IN ${last?.in ?? 0}, OUT ${last?.out ?? 0}${
      (entry as any).expected
        ? `  (expected IN ${(entry as any).expected.in}, OUT ${(entry as any).expected.out})`
        : ''
    }`
  );
  console.log(`Copy     ${out}`);
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
