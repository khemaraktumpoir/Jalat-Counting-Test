import { Box, centerOf, Detection, Track } from './types';

export interface TrackerOptions {
  /** A detection continues a track when their boxes overlap at least this much (IoU). */
  iouThreshold?: number;
  /** Frames a track may go unseen before it is dropped. */
  maxMissed?: number;
}

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * IoU tracker: each frame, the best-overlapping pairs of (track, detection) of the same class are
 * matched greedily; matched tracks move on, new detections start tracks, unseen tracks wait
 * `maxMissed` frames before they are dropped.
 */
export class IouTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private readonly iouThreshold: number;
  private readonly maxMissed: number;

  constructor(options: TrackerOptions = {}) {
    this.iouThreshold = options.iouThreshold ?? 0.3;
    this.maxMissed = options.maxMissed ?? 10;
  }

  /** This frame's detections in; the tracks seen on this frame out. */
  update(detections: Detection[]): Track[] {
    const pairs: { t: number; d: number; score: number }[] = [];
    this.tracks.forEach((track, t) =>
      detections.forEach((det, d) => {
        if (det.classId !== track.classId) return;
        const score = iou(track.box, det.box);
        if (score >= this.iouThreshold) pairs.push({ t, d, score });
      })
    );
    pairs.sort((a, b) => b.score - a.score);

    const usedTracks = new Set<number>();
    const usedDetections = new Set<number>();
    for (const { t, d } of pairs) {
      if (usedTracks.has(t) || usedDetections.has(d)) continue;
      usedTracks.add(t);
      usedDetections.add(d);
      const track = this.tracks[t];
      const det = detections[d];
      track.prevCenter = track.center;
      track.box = det.box;
      track.score = det.score;
      track.center = centerOf(det.box);
      track.missed = 0;
      track.hits += 1;
    }

    this.tracks.forEach((track, t) => {
      if (!usedTracks.has(t)) track.missed += 1;
    });
    this.tracks = this.tracks.filter(track => track.missed <= this.maxMissed);

    detections.forEach((det, d) => {
      if (usedDetections.has(d)) return;
      this.tracks.push({
        id: this.nextId++,
        classId: det.classId,
        box: det.box,
        score: det.score,
        center: centerOf(det.box),
        prevCenter: null,
        missed: 0,
        hits: 1
      });
    });

    return this.tracks.filter(track => track.missed === 0);
  }

  /** Every live track (seen or waiting). */
  all(): Track[] {
    return [...this.tracks];
  }

  reset(): void {
    this.tracks = [];
    this.nextId = 1;
  }
}
