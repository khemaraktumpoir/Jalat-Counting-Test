/**
 * The counting core (src/lib/counting): plain TypeScript, no Nest and no onnxruntime import, so it
 * runs in a camera worker thread and is tested without a model.
 */

export interface Point {
  x: number;
  y: number;
}

/** A box in pixels of the source frame: top-left and bottom-right. */
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One RGB frame (rgb24: 3 bytes a pixel, rows top to bottom), as ffmpeg sends it. */
export interface Frame {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Detection {
  box: Box;
  score: number;
  classId: number;
}

export interface Track {
  id: number;
  classId: number;
  box: Box;
  score: number;
  center: Point;
  /** The center on the previous frame it was seen; null on its first frame. */
  prevCenter: Point | null;
  /** Frames in a row without a matching detection. */
  missed: number;
  /** Frames it was matched on. */
  hits: number;
}

export interface ClassCount {
  in: number;
  out: number;
}

export interface Counts {
  in: number;
  out: number;
  /** Per label (models/classes.json), e.g. { parcel: { in: 3, out: 0 } }. */
  byClass: Record<string, ClassCount>;
}

export type CountDirection = 'IN' | 'OUT';

export interface CountEvent {
  trackId: number;
  classId: number;
  label: string;
  direction: CountDirection;
}

/** A counter: a line or a polygon. */
export interface Counter {
  /** Feeds this frame's tracks; returns the crossings made on it. */
  update(tracks: Track[], labelOf: (classId: number) => string): CountEvent[];
  counts(): Counts;
  reset(): void;
}

export const emptyCounts = (): Counts => ({ in: 0, out: 0, byClass: {} });

export const centerOf = (box: Box): Point => ({
  x: (box.x1 + box.x2) / 2,
  y: (box.y1 + box.y2) / 2
});

/** Adds a count event to running counts (in place). */
export function addEvent(counts: Counts, event: CountEvent): void {
  const byClass = (counts.byClass[event.label] ??= { in: 0, out: 0 });
  if (event.direction === 'IN') {
    counts.in += 1;
    byClass.in += 1;
  } else {
    counts.out += 1;
    byClass.out += 1;
  }
}
