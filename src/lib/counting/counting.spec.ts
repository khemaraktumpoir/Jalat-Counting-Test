import { Detector, ModelOutput, parseDetections } from './detector';
import { LineCounter, segmentsIntersect } from './line-counter';
import { CountingPipeline } from './pipeline';
import { pointInPolygon, PolygonCounter } from './polygon-counter';
import { letterbox, toSourceBox } from './preprocess';
import { iou, IouTracker } from './tracker';
import { Box, Detection, Frame, Track } from './types';

const label = (id: number) => (id === 0 ? 'parcel' : `class ${id}`);
const det = (x: number, y: number, classId = 0, size = 20): Detection => ({
  box: { x1: x - size / 2, y1: y - size / 2, x2: x + size / 2, y2: y + size / 2 },
  score: 0.9,
  classId
});
const track = (
  id: number,
  prev: [number, number] | null,
  now: [number, number],
  classId = 0
): Track => ({
  id,
  classId,
  box: { x1: now[0] - 5, y1: now[1] - 5, x2: now[0] + 5, y2: now[1] + 5 },
  score: 0.9,
  center: { x: now[0], y: now[1] },
  prevCenter: prev ? { x: prev[0], y: prev[1] } : null,
  missed: 0,
  hits: 2
});
const frameOf = (width: number, height: number, fill = 0): Frame => ({
  data: new Uint8Array(width * height * 3).fill(fill),
  width,
  height
});

describe('preprocess and coordinate mapping', () => {
  it('letterboxes a wide frame: scaled to fit, grey bars top and bottom', () => {
    const lb = letterbox(frameOf(1280, 720, 255), 640);
    expect(lb.scale).toBeCloseTo(0.5);
    expect(lb.padX).toBe(0);
    expect(lb.padY).toBe(140);
    expect(lb.tensor.length).toBe(3 * 640 * 640);
    // A bar pixel is grey (114/255), an image pixel white (1), in every channel.
    expect(lb.tensor[0]).toBeCloseTo(114 / 255);
    expect(lb.tensor[320 * 640 + 320]).toBeCloseTo(1);
    expect(lb.tensor[2 * 640 * 640 + 320 * 640 + 320]).toBeCloseTo(1);
  });

  it('keeps colours in their channel (RGB, channels first)', () => {
    const frame = frameOf(4, 4);
    for (let i = 0; i < frame.data.length; i += 3) frame.data[i] = 255; // red
    const lb = letterbox(frame, 8);
    const plane = 64;
    expect(lb.tensor[0 * plane + 9]).toBeCloseTo(1);
    expect(lb.tensor[1 * plane + 9]).toBeCloseTo(0);
    expect(lb.tensor[2 * plane + 9]).toBeCloseTo(0);
  });

  it('maps a model box back to the source frame', () => {
    const lb = { scale: 0.5, padX: 0, padY: 140 };
    const box = toSourceBox({ x1: 100, y1: 190, x2: 200, y2: 240 }, lb, 1280, 720);
    expect(box).toEqual({ x1: 200, y1: 100, x2: 400, y2: 200 });
  });

  it('clamps boxes to the frame', () => {
    const box = toSourceBox(
      { x1: -10, y1: 100, x2: 700, y2: 700 },
      { scale: 0.5, padX: 0, padY: 140 },
      1280,
      720
    );
    expect(box.x1).toBe(0);
    expect(box.x2).toBe(1280);
    expect(box.y2).toBe(720);
  });
});

describe('parseDetections', () => {
  const output = (rows: number[][]): ModelOutput => ({
    data: Float32Array.from(rows.flat()),
    dims: [1, rows.length, 6]
  });
  const lb = { scale: 1, padX: 0, padY: 0 };

  it('keeps detections over the confidence, of the wanted classes', () => {
    const out = output([
      [10, 10, 50, 50, 0.9, 0],
      [10, 10, 50, 50, 0.2, 0],
      [60, 60, 90, 90, 0.8, 2],
      [0, 0, 0, 0, 0, 0]
    ]);
    expect(parseDetections(out, lb, 640, 640, { conf: 0.5 })).toHaveLength(2);
    const parcels = parseDetections(out, lb, 640, 640, { conf: 0.5, classes: [0] });
    expect(parcels).toHaveLength(1);
    expect(parcels[0].box).toEqual({ x1: 10, y1: 10, x2: 50, y2: 50 });
  });

  it('refuses an output that is not [1, N, 6]', () => {
    expect(() =>
      parseDetections({ data: new Float32Array(84), dims: [1, 84, 1] }, lb, 640, 640, { conf: 0.5 })
    ).toThrow(/expected \[1, N, 6\]/);
  });
});

describe('IouTracker', () => {
  it('measures overlap', () => {
    const a: Box = { x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(iou(a, a)).toBe(1);
    expect(iou(a, { x1: 5, y1: 0, x2: 15, y2: 10 })).toBeCloseTo(50 / 150);
    expect(iou(a, { x1: 20, y1: 20, x2: 30, y2: 30 })).toBe(0);
  });

  it('keeps an id while a box moves, and gives a new box a new id', () => {
    const tracker = new IouTracker();
    const [first] = tracker.update([det(100, 100)]);
    const [moved] = tracker.update([det(104, 100)]);
    expect(moved.id).toBe(first.id);
    expect(moved.prevCenter).toEqual({ x: 100, y: 100 });
    const next = tracker.update([det(108, 100), det(400, 400)]);
    expect(next.map(t => t.id).sort()).toEqual([first.id, first.id + 1]);
  });

  it('does not match across classes', () => {
    const tracker = new IouTracker();
    const [a] = tracker.update([det(100, 100, 0)]);
    const [b] = tracker.update([det(100, 100, 1)]);
    expect(b.id).not.toBe(a.id);
  });

  it('keeps an unseen track for maxMissed frames, then drops it', () => {
    const tracker = new IouTracker({ maxMissed: 2 });
    const [a] = tracker.update([det(100, 100)]);
    tracker.update([]);
    tracker.update([]);
    const [back] = tracker.update([det(100, 100)]);
    expect(back.id).toBe(a.id);
    tracker.update([]);
    tracker.update([]);
    tracker.update([]);
    const [fresh] = tracker.update([det(100, 100)]);
    expect(fresh.id).not.toBe(a.id);
  });
});

describe('LineCounter', () => {
  // A horizontal line drawn left → right at y = 100: IN is upwards (its left side, y down).
  const line = () => new LineCounter({ x: 0, y: 100 }, { x: 200, y: 100 });

  it('finds crossing segments', () => {
    expect(
      segmentsIntersect({ x: 50, y: 90 }, { x: 50, y: 110 }, { x: 0, y: 100 }, { x: 200, y: 100 })
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 250, y: 90 }, { x: 250, y: 110 }, { x: 0, y: 100 }, { x: 200, y: 100 })
    ).toBe(false);
  });

  it('counts IN going up and OUT going down', () => {
    const counter = line();
    expect(counter.update([track(1, [50, 120], [50, 80])], label)[0].direction).toBe('IN');
    expect(counter.update([track(2, [60, 80], [60, 120])], label)[0].direction).toBe('OUT');
    expect(counter.counts()).toEqual({ in: 1, out: 1, byClass: { parcel: { in: 1, out: 1 } } });
  });

  it('counts a track once, even when it crosses back', () => {
    const counter = line();
    counter.update([track(1, [50, 120], [50, 80])], label);
    counter.update([track(1, [50, 80], [50, 120])], label);
    counter.update([track(1, [50, 120], [50, 80])], label);
    expect(counter.counts().in + counter.counts().out).toBe(1);
  });

  it('ignores moves beside the line, along it, or a first frame', () => {
    const counter = line();
    counter.update([track(1, [250, 120], [250, 80])], label);
    counter.update([track(2, [10, 100], [60, 100])], label);
    counter.update([track(3, null, [50, 80])], label);
    expect(counter.counts().in + counter.counts().out).toBe(0);
  });

  it('counts a center that stops exactly on the line, once it moves off it', () => {
    const counter = line();
    counter.update([track(1, [50, 140], [50, 120])], label);
    expect(counter.update([track(1, [50, 120], [50, 100])], label)).toHaveLength(0);
    expect(counter.update([track(1, [50, 100], [50, 80])], label)[0].direction).toBe('IN');
  });

  it('does not count a track that touches the line and goes back', () => {
    const counter = line();
    counter.update([track(1, [50, 120], [50, 100])], label);
    counter.update([track(1, [50, 100], [50, 120])], label);
    expect(counter.counts().in + counter.counts().out).toBe(0);
  });

  it('starts over on reset', () => {
    const counter = line();
    counter.update([track(1, [50, 120], [50, 80])], label);
    counter.reset();
    expect(counter.counts()).toEqual({ in: 0, out: 0, byClass: {} });
    counter.update([track(1, [50, 120], [50, 80])], label);
    expect(counter.counts().in).toBe(1);
  });
});

describe('PolygonCounter', () => {
  const square = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 }
  ];

  it('knows inside from outside', () => {
    expect(pointInPolygon({ x: 150, y: 150 }, square)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 150 }, square)).toBe(false);
  });

  it('counts IN on entering and OUT on leaving', () => {
    const counter = new PolygonCounter(square);
    counter.update([track(1, null, [50, 150])], label);
    expect(counter.update([track(1, [50, 150], [150, 150])], label)[0].direction).toBe('IN');
    expect(counter.update([track(1, [150, 150], [250, 150])], label)[0].direction).toBe('OUT');
    expect(counter.counts()).toEqual({ in: 1, out: 1, byClass: { parcel: { in: 1, out: 1 } } });
  });

  it('does not count a track first seen inside, nor jitter on the edge twice', () => {
    const counter = new PolygonCounter(square);
    counter.update([track(1, null, [150, 150])], label);
    counter.update([track(2, null, [95, 150])], label);
    counter.update([track(2, [95, 150], [105, 150])], label);
    counter.update([track(2, [105, 150], [95, 150])], label);
    counter.update([track(2, [95, 150], [105, 150])], label);
    expect(counter.counts()).toEqual({ in: 1, out: 1, byClass: { parcel: { in: 1, out: 1 } } });
  });

  it('needs 3 points', () => {
    expect(() => new PolygonCounter(square.slice(0, 2))).toThrow();
  });
});

describe('CountingPipeline', () => {
  it('counts a box moving across the line, frame by frame', async () => {
    // A fake model: one parcel box (80 model px tall) whose center moves up 20 model px a frame,
    // from y=420 to y=300, so consecutive boxes overlap and stay one track.
    const ys = [420, 400, 380, 360, 340, 320, 300];
    let i = 0;
    const detector = new Detector(async () => {
      const y = ys[Math.min(i++, ys.length - 1)];
      return { data: Float32Array.from([300, y - 40, 340, y + 40, 0.9, 0]), dims: [1, 1, 6] };
    }, 640);
    const pipeline = new CountingPipeline(detector, {
      conf: 0.5,
      labels: { 0: 'parcel' },
      // Source 1280×720 → model scale 0.5, padY 140: model y 360 is source y 440.
      region: {
        type: 'LINE',
        points: [
          { x: 0, y: 440 },
          { x: 1280, y: 440 }
        ]
      }
    });
    const frame = frameOf(1280, 720);
    let last;
    for (let f = 0; f < ys.length; f += 1) last = await pipeline.process(frame);
    expect(last!.in).toBe(1);
    expect(last!.out).toBe(0);
    expect(last!.byClass).toEqual({ parcel: { in: 1, out: 0 } });
    pipeline.reset();
    expect(pipeline.counts().in).toBe(0);
  });
});

describe('ColorDetector (demo)', () => {
  it('finds an orange box and not the grey belt', async () => {
    const frame = frameOf(320, 240, 150);
    for (let y = 80; y < 160; y += 1)
      for (let x = 100; x < 200; x += 1) {
        const i = (y * 320 + x) * 3;
        frame.data[i] = 247;
        frame.data[i + 1] = 148;
        frame.data[i + 2] = 31;
      }
    const { ColorDetector } = await import('./color-detector');
    const found = await new ColorDetector(4, 4).detect(frame, { conf: 0.4 });
    expect(found).toHaveLength(1);
    expect(found[0].box.x1).toBeGreaterThanOrEqual(96);
    expect(found[0].box.x2).toBeLessThanOrEqual(204);
    expect(found[0].box.y1).toBeGreaterThanOrEqual(76);
    expect(found[0].box.y2).toBeLessThanOrEqual(164);
  });
});
