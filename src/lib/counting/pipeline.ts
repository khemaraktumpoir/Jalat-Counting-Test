import { DetectOptions } from './detector';
import { COLORS, drawBox, drawInArrow, drawPolyline } from './draw';
import { LineCounter } from './line-counter';
import { PolygonCounter } from './polygon-counter';
import { IouTracker, TrackerOptions } from './tracker';
import { CountEvent, Counter, Counts, Detection, Frame, Point, Track } from './types';

/** Anything that turns a frame into detections: the ONNX Detector, or the demo ColorDetector. */
export interface DetectorLike {
  detect(frame: Frame, options: DetectOptions): Promise<Detection[]>;
}

export type RegionShape = { type: 'LINE' | 'POLYGON'; points: Point[] };

export interface PipelineOptions extends DetectOptions, TrackerOptions {
  region: RegionShape;
  /** Class index → label (models/classes.json). */
  labels: Record<number, string>;
}

export interface PipelineResult {
  in: number;
  out: number;
  byClass: Counts['byClass'];
  /** The crossings made on this frame. */
  events: CountEvent[];
  tracks: Track[];
  detections: Detection[];
}

/** A region as a counter; refuses shapes that cannot count. */
export function counterFor(region: RegionShape): Counter {
  if (region.type === 'LINE') {
    if (region.points.length !== 2) throw new Error('A counting line needs exactly 2 points.');
    return new LineCounter(region.points[0], region.points[1]);
  }
  return new PolygonCounter(region.points);
}

/** Frame → detect → track → count. One per camera. */
export class CountingPipeline {
  private tracker: IouTracker;
  private counter: Counter;
  private options: PipelineOptions;

  constructor(private readonly detector: DetectorLike, options: PipelineOptions) {
    this.options = options;
    this.tracker = new IouTracker(options);
    this.counter = counterFor(options.region);
  }

  private labelOf = (classId: number) => this.options.labels[classId] ?? `class ${classId}`;

  async process(frame: Frame): Promise<PipelineResult> {
    const detections = await this.detector.detect(frame, this.options);
    const tracks = this.tracker.update(detections);
    const events = this.counter.update(tracks, this.labelOf);
    if (this.counter instanceof PolygonCounter || this.counter instanceof LineCounter) {
      this.counter.forget(new Set(this.tracker.all().map(t => t.id)));
    }
    const counts = this.counter.counts();
    return { ...counts, events, tracks, detections };
  }

  counts(): Counts {
    return this.counter.counts();
  }

  /** New settings (region, confidence, classes) without losing the running counts unless the region changed. */
  update(options: Partial<PipelineOptions>): void {
    const regionChanged =
      options.region && JSON.stringify(options.region) !== JSON.stringify(this.options.region);
    this.options = { ...this.options, ...options };
    if (regionChanged) {
      this.counter = counterFor(this.options.region);
      this.tracker.reset();
    }
  }

  reset(): void {
    this.counter.reset();
    this.tracker.reset();
  }

  /** Draws the region, the IN arrow and the tracked boxes on a frame (for the live preview). */
  annotate(frame: Frame, tracks: Track[]): void {
    const { region } = this.options;
    drawPolyline(frame, region.points, COLORS.region, region.type === 'POLYGON');
    if (region.type === 'LINE')
      drawInArrow(frame, region.points[0], region.points[1], COLORS.inArrow);
    for (const track of tracks) drawBox(frame, track.box, COLORS.box);
  }
}
