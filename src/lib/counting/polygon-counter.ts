import { structuredCloneCounts } from './line-counter';
import { addEvent, CountEvent, Counter, Counts, emptyCounts, Point, Track } from './types';

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

/**
 * Counts tracks whose center goes from outside the area to inside (IN) or inside to outside
 * (OUT), each direction at most once per track (a box jittering on the edge counts once). A track
 * first seen inside the area is not counted IN: it was already there.
 */
export class PolygonCounter implements Counter {
  private readonly inside = new Map<number, boolean>();
  private readonly counted = new Map<number, Set<string>>();
  private totals: Counts = emptyCounts();

  constructor(private readonly polygon: Point[]) {
    if (polygon.length < 3) throw new Error('A counting area needs at least 3 points.');
  }

  update(tracks: Track[], labelOf: (classId: number) => string): CountEvent[] {
    const events: CountEvent[] = [];
    for (const track of tracks) {
      const now = pointInPolygon(track.center, this.polygon);
      const before = this.inside.get(track.id);
      this.inside.set(track.id, now);
      if (before === undefined || before === now) continue;
      const direction = now ? 'IN' : 'OUT';
      const done = this.counted.get(track.id) ?? new Set<string>();
      if (done.has(direction)) continue;
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
    }
    return events;
  }

  /** Forgets tracks the tracker dropped (keeps the maps small on a long run). */
  forget(liveTrackIds: Set<number>): void {
    for (const id of this.inside.keys()) {
      if (!liveTrackIds.has(id)) {
        this.inside.delete(id);
        this.counted.delete(id);
      }
    }
  }

  counts(): Counts {
    return structuredCloneCounts(this.totals);
  }

  reset(): void {
    this.inside.clear();
    this.counted.clear();
    this.totals = emptyCounts();
  }
}
