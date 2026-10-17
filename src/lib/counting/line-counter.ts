import { addEvent, CountEvent, Counter, Counts, emptyCounts, Point, Track } from './types';

/** Which side of the directed line a→b a point is on: >0 left, <0 right, 0 on it. */
export function sideOf(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Do segments p1–p2 and q1–q2 cross (touching counts)? */
export function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = sideOf(q1, q2, p1);
  const d2 = sideOf(q1, q2, p2);
  const d3 = sideOf(p1, p2, q1);
  const d4 = sideOf(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))
    return true;
  const onSegment = (a: Point, b: Point, p: Point) =>
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y);
  return (
    (d1 === 0 && onSegment(q1, q2, p1)) ||
    (d2 === 0 && onSegment(q1, q2, p2)) ||
    (d3 === 0 && onSegment(p1, p2, q1)) ||
    (d4 === 0 && onSegment(p1, p2, q2))
  );
}

/**
 * Counts tracks whose center crosses the line a→b between two frames, once per track. IN is a
 * crossing from the right of a→b to its left (the arrow the region editor draws); OUT the other way.
 * In image coordinates (y down) the left of a line drawn left→right is above it.
 */
export class LineCounter implements Counter {
  private readonly counted = new Set<number>();
  /** Each track's last side of the line that was not on it (-1 or 1). */
  private readonly lastSide = new Map<number, number>();
  private totals: Counts = emptyCounts();

  constructor(private readonly a: Point, private readonly b: Point) {}

  update(tracks: Track[], labelOf: (classId: number) => string): CountEvent[] {
    const events: CountEvent[] = [];
    for (const track of tracks) {
      const now = Math.sign(sideOf(this.a, this.b, track.center));
      if (!this.lastSide.has(track.id) && track.prevCenter) {
        const before = Math.sign(sideOf(this.a, this.b, track.prevCenter));
        if (before !== 0) this.lastSide.set(track.id, before);
      }
      const last = this.lastSide.get(track.id);
      // A center exactly on the line has no side yet: wait for the next frame (keep the last one).
      if (now === 0) continue;
      this.lastSide.set(track.id, now);
      if (this.counted.has(track.id) || !track.prevCenter || last === undefined || last === now)
        continue;
      // The side changed: count it only when the move touched the line itself, not beside it.
      if (!segmentsIntersect(track.prevCenter, track.center, this.a, this.b)) continue;
      // y down: the left of a→b has a negative side value.
      const direction = now < 0 ? 'IN' : 'OUT';
      const event: CountEvent = {
        trackId: track.id,
        classId: track.classId,
        label: labelOf(track.classId),
        direction
      };
      this.counted.add(track.id);
      addEvent(this.totals, event);
      events.push(event);
    }
    return events;
  }

  /** Forgets tracks the tracker dropped (keeps the maps small on a long run). */
  forget(liveTrackIds: Set<number>): void {
    for (const id of this.lastSide.keys()) {
      if (!liveTrackIds.has(id)) {
        this.lastSide.delete(id);
        this.counted.delete(id);
      }
    }
  }

  counts(): Counts {
    return structuredCloneCounts(this.totals);
  }

  reset(): void {
    this.counted.clear();
    this.lastSide.clear();
    this.totals = emptyCounts();
  }
}

export const structuredCloneCounts = (c: Counts): Counts => ({
  in: c.in,
  out: c.out,
  byClass: Object.fromEntries(Object.entries(c.byClass).map(([k, v]) => [k, { ...v }]))
});
