import { structuredCloneCounts } from './line-counter';
import { iou } from './tracker';
import { addEvent, Box, CountEvent, Counter, Counts, emptyCounts, Point, Track } from './types';

/** Ray casting: is p inside the polygon (points in order, not closed)? */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

export interface PolygonCounterOptions {
  /** Pictures a parcel is seen on before it counts: a box the model gives once never counts. */
  steady?: number;
  /** Pictures a counted parcel lost from sight is remembered where it was (not counted again there). */
  remember?: number;
}

const areaOf = (b: Box) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const overlapOf = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) *
  Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

/**
 * Whether a new box shows parcels already counted (`counted`: their boxes), not a new parcel:
 *   - nearly the same box as one of them (IoU 0.5 or more): that parcel, found again or boxed twice;
 *   - a box round two or more of them (each 70 % or more inside it) that fill most of it: one box
 *     drawn round several touching parcels.
 * A parcel of a pile only partly overlapping its neighbours is neither: it is a new parcel.
 */
export function showsCountedParcels(box: Box, counted: Box[]): boolean {
  if (counted.some(c => iou(c, box) >= 0.5)) return true;
  const area = areaOf(box);
  const parts = counted.filter(c => areaOf(c) > 0 && overlapOf(c, box) / areaOf(c) >= 0.7);
  const filled = parts.reduce((sum, c) => sum + overlapOf(c, box), 0);
  return parts.length >= 2 && area > 0 && filled >= 0.6 * area;
}

/**
 * Counts the parcels in the area: every parcel whose center is inside it counts IN once, when it
 * has been seen on `steady` pictures, whether it was carried in, put down while the camera did not
 * look (a slow camera sees about one picture a second) or already there; a counted parcel leaving
 * the area counts OUT once. A box jittering on the edge counts once each way.
 *
 * A new box that shows parcels already counted (showsCountedParcels) is not counted: one box drawn
 * round two touching parcels on some pictures (27 Oct 2026: two pink mailers, counted 4 for 3), or
 * a counted parcel the tracker lost (someone standing over it) and found again where it was,
 * within `remember` pictures.
 */
export class PolygonCounter implements Counter {
  private readonly inside = new Map<number, boolean>();
  private readonly counted = new Map<number, Set<string>>();
  private readonly lastBox = new Map<number, Box>();
  /** Counted parcels lost from sight while inside: where they were, and when (update number). */
  private remembered: { box: Box; at: number }[] = [];
  private updates = 0;
  private totals: Counts = emptyCounts();
  private readonly steady: number;
  private readonly remember: number;

  constructor(private readonly polygon: Point[], options: PolygonCounterOptions = {}) {
    if (polygon.length < 3) throw new Error('A counting area needs at least 3 points.');
    this.steady = options.steady ?? 4;
    this.remember = options.remember ?? 120;
  }

  update(tracks: Track[], labelOf: (classId: number) => string): CountEvent[] {
    this.updates += 1;
    this.remembered = this.remembered.filter(r => this.updates - r.at <= this.remember);
    const events: CountEvent[] = [];
    const count = (track: Track, direction: 'IN' | 'OUT') => {
      const done = this.counted.get(track.id) ?? new Set<string>();
      if (done.has(direction)) return;
      done.add(direction);
      this.counted.set(track.id, done);
      const event: CountEvent = {
        trackId: track.id,
        classId: track.classId,
        label: labelOf(track.classId),
        direction
      };
      addEvent(this.totals, event);
      events.push(event);
    };

    for (const track of tracks) {
      const now = pointInPolygon(track.center, this.polygon);
      const before = this.inside.get(track.id);
      this.inside.set(track.id, now);
      this.lastBox.set(track.id, track.box);
      const done = this.counted.get(track.id);

      if (now && !done?.has('IN') && track.hits >= this.steady) {
        // Parcels already counted (in view, or lost there lately), seen again: not new ones.
        if (showsCountedParcels(track.box, this.countedBoxes(track.id))) {
          this.counted.set(track.id, new Set([...(done ?? []), 'IN']));
          const at = this.remembered.findIndex(r => iou(r.box, track.box) >= 0.5);
          if (at >= 0) this.remembered.splice(at, 1);
        } else count(track, 'IN');
      } else if (before === true && !now && done?.has('IN')) count(track, 'OUT');
    }
    return events;
  }

  /** Where the counted parcels are: those in the area now (but `except`), and those lost there lately. */
  private countedBoxes(except: number): Box[] {
    const boxes = this.remembered.map(r => r.box);
    for (const [id, done] of this.counted) {
      const box = this.lastBox.get(id);
      if (id !== except && box && done.has('IN') && !done.has('OUT') && this.inside.get(id))
        boxes.push(box);
    }
    return boxes;
  }

  /** Forgets tracks the tracker dropped; a counted one lost inside the area is remembered where it was. */
  forget(liveTrackIds: Set<number>): void {
    for (const id of this.inside.keys()) {
      if (liveTrackIds.has(id)) continue;
      const done = this.counted.get(id);
      const box = this.lastBox.get(id);
      if (this.inside.get(id) && done?.has('IN') && !done.has('OUT') && box)
        this.remembered.push({ box, at: this.updates });
      this.inside.delete(id);
      this.counted.delete(id);
      this.lastBox.delete(id);
    }
  }

  counts(): Counts {
    return structuredCloneCounts(this.totals);
  }

  reset(): void {
    this.inside.clear();
    this.counted.clear();
    this.lastBox.clear();
    this.remembered = [];
    this.updates = 0;
    this.totals = emptyCounts();
  }
}
