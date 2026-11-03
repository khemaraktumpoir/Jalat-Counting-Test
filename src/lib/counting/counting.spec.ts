import { Detector, ModelOutput, parseDetections } from './detector';
import { shrinkFrame } from './draw';
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

  it("counts the parcel model's words for one thing as one class (fold), then keeps the wanted ones", () => {
    // parcel (0), mailer bag (1), gift bag (3): all "parcel"; a camera keeping class 0 counts them all.
    const out = output([
      [10, 10, 50, 50, 0.9, 0],
      [60, 60, 90, 90, 0.8, 1],
      [100, 100, 150, 150, 0.7, 3]
    ]);
    const fold = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const parcels = parseDetections(out, lb, 640, 640, { conf: 0.5, classes: [0], fold });
    expect(parcels.map(d => d.classId)).toEqual([0, 0, 0]);
    expect(parseDetections(out, lb, 640, 640, { conf: 0.5, classes: [0] })).toHaveLength(1);
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

  /** A track seen on `hits` pictures. */
  const seen = (hits: number, ...args: Parameters<typeof track>): Track => ({
    ...track(...args),
    hits
  });

  it('counts IN on entering and OUT on leaving', () => {
    const counter = new PolygonCounter(square);
    counter.update([seen(4, 1, null, [50, 150])], label);
    expect(counter.update([seen(5, 1, [50, 150], [150, 150])], label)[0].direction).toBe('IN');
    expect(counter.update([seen(6, 1, [150, 150], [250, 150])], label)[0].direction).toBe('OUT');
    expect(counter.counts()).toEqual({ in: 1, out: 1, byClass: { parcel: { in: 1, out: 1 } } });
  });

  it('counts parcels already lying in the area, once each, when seen on 4 pictures', () => {
    const counter = new PolygonCounter(square);
    const pile = (hits: number) => [
      seen(hits, 1, null, [130, 130]),
      seen(hits, 2, null, [170, 170])
    ];
    for (const hits of [1, 2, 3]) expect(counter.update(pile(hits), label)).toHaveLength(0);
    expect(counter.update(pile(4), label)).toHaveLength(2);
    expect(counter.update(pile(5), label)).toHaveLength(0);
    expect(counter.counts().in).toBe(2);
  });

  it('never counts a box seen on fewer than 4 pictures, nor jitter on the edge twice', () => {
    const counter = new PolygonCounter(square);
    for (const hits of [1, 2, 3]) counter.update([seen(hits, 9, null, [150, 150])], label);
    counter.update([seen(4, 2, null, [95, 150])], label);
    counter.update([seen(5, 2, [95, 150], [105, 150])], label);
    counter.update([seen(6, 2, [105, 150], [95, 150])], label);
    counter.update([seen(7, 2, [95, 150], [105, 150])], label);
    expect(counter.counts()).toEqual({ in: 1, out: 1, byClass: { parcel: { in: 1, out: 1 } } });
  });

  it('does not count again a counted parcel lost from sight and found where it was', () => {
    const counter = new PolygonCounter(square);
    counter.update([seen(4, 1, null, [150, 150])], label);
    counter.forget(new Set()); // someone stood over it: the tracker dropped it
    counter.update([seen(4, 2, null, [152, 151])], label); // the same parcel, a new track, a little moved
    counter.update([seen(4, 3, null, [115, 115])], label); // another parcel put down next to it
    expect(counter.counts().in).toBe(2);
  });

  it('does not count one box drawn round two counted parcels as a third (27 Oct 2026: 4 for 3)', () => {
    const counter = new PolygonCounter(square);
    const box = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2 });
    const parcel = (id: number, b: Track['box'], hits = 4): Track => ({
      ...seen(hits, id, null, [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]),
      box: b
    });
    // Two pink mailers overlapping, both counted.
    counter.update([parcel(1, box(110, 110, 160, 150)), parcel(2, box(140, 130, 190, 170))], label);
    expect(counter.counts().in).toBe(2);
    // Some pictures later the model draws one box round both: not a new parcel.
    counter.update(
      [
        parcel(1, box(110, 110, 160, 150), 9),
        parcel(2, box(140, 130, 190, 170), 9),
        parcel(3, box(108, 108, 192, 172))
      ],
      label
    );
    expect(counter.counts().in).toBe(2);
  });

  it('counts every parcel of a pile that only partly overlap each other (27 Oct 2026: 3 on the floor)', () => {
    // The camera model's boxes on the floor picture: two pink mailers and an orange one, each
    // overlapping its neighbours; together they cover most of the middle one.
    const floor = [
      { x: 300, y: 400 },
      { x: 720, y: 400 },
      { x: 720, y: 780 },
      { x: 300, y: 780 }
    ];
    const counter = new PolygonCounter(floor);
    const at = (id: number, x1: number, y1: number, x2: number, y2: number): Track => ({
      ...seen(4, id, null, [(x1 + x2) / 2, (y1 + y2) / 2]),
      box: { x1, y1, x2, y2 }
    });
    counter.update(
      [at(1, 387, 612, 623, 757), at(2, 393, 496, 573, 575), at(3, 394, 538, 584, 651)],
      label
    );
    expect(counter.counts().in).toBe(3);
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

describe('shrinkFrame (the live preview)', () => {
  const frameOf = (width: number, height: number, rgb: (x: number, y: number) => number[]) => {
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) data.set(rgb(x, y), (y * width + x) * 3);
    return { data, width, height };
  };

  it('halves a 1280×720 camera to 640×360, each pixel the average of its block', () => {
    const big = frameOf(1280, 720, x => (x % 2 ? [200, 100, 0] : [100, 50, 0]));
    const small = shrinkFrame(big, 640);
    expect([small.width, small.height]).toEqual([640, 360]);
    expect(Array.from(small.data.subarray(0, 3))).toEqual([150, 75, 0]);
  });

  it('shrinks a 1920×1080 camera by 3, and leaves a small frame as it is', () => {
    expect(
      shrinkFrame(
        frameOf(1920, 1080, () => [0, 0, 0]),
        640
      ).width
    ).toBe(640);
    const small = frameOf(640, 360, () => [1, 2, 3]);
    expect(shrinkFrame(small, 640)).toBe(small);
  });
});
