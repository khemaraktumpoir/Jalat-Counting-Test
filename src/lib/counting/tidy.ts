import { Detection } from './types';

// The parcel model's boxes, tidied (moved from the photo counter, 27 Oct 2026, so the cameras use
// the same rules as photos: graphql/counting/photo-count.service re-exports them).

/**
 * duplicate: the same parcel boxed twice; floor: a box over most of the photo; weak: a weak guess
 * lying on a surer parcel; group: one box around several parcels that have boxes of their own
 */
export type SkipReason = 'duplicate' | 'floor' | 'weak' | 'group';

/** Below this score a box is a weak guess: kept only when it isn't lying on a surer parcel. */
export const WEAK_PARCEL = 0.1;

/** A box needs at least this score to make a bigger box around it and another parcel a group. */
export const GROUP_PART = 0.05;

/** Two overlapping boxes are one parcel only when the smaller is at least this share of the bigger. */
export const SAME_SIZE = 0.45;

/**
 * The parcel model's boxes, tidied: a box over most of the photo is the floor, and a box mostly
 * inside another (or around it) is the same parcel seen twice; the more certain one stays. A weak
 * guess (under WEAK_PARCEL) lying for the most part on a surer parcel is the floor or a corner of
 * it; a weak guess on its own (a parcel wrapped in paper, which the model finds hard) stays.
 *
 * Parcels laid touching on a mat (real pickup piles, 27 Oct 2026) also get one box around two or
 * three of them, often surer than each parcel's own: such a box, holding two or more parcels that
 * have their own boxes and fill most of it, is a group, and the parcels count instead. One parcel
 * lying on a bigger one (a mailer on a bag) is not a group: the bigger one has only one inside.
 */
export function tidyParcels(detections: Detection[], width: number, height: number): Detection[] {
  return sortParcels(detections, width, height).kept;
}

/** tidyParcels, with the boxes it leaves out and why. */
export function sortParcels(
  detections: Detection[],
  width: number,
  height: number
): { kept: Detection[]; skipped: { detection: Detection; reason: SkipReason }[] } {
  const area = (b: Detection['box']) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const inside = (a: Detection['box'], b: Detection['box']) => {
    const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
    const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
    return area(a) ? (w * h) / area(a) : 0;
  };
  const kept: Detection[] = [];
  const skipped: { detection: Detection; reason: SkipReason }[] = [];
  // Over most of the photo, or a weak guess over a big part of it: the mat parcels lie on. A parcel
  // that big in the picture is a sure one.
  const floor = (d: Detection) =>
    area(d.box) > (d.score < WEAK_PARCEL ? 0.2 : 0.45) * width * height;
  /**
   * One parcel boxed twice: mostly on top of each other and about the same size. A small parcel
   * lying on a bigger one (a mailer on a bag) is mostly inside it too, but much smaller.
   */
  const sameParcel = (a: Detection, b: Detection) => {
    const [small, big] = area(a.box) <= area(b.box) ? [a, b] : [b, a];
    return inside(small.box, big.box) > 0.6 && area(small.box) >= SAME_SIZE * area(big.box);
  };
  /**
   * A weak box lying on a surer parcel that is a piece of it: corner-sized (the floor or a corner
   * of that parcel) or sticker-sized (its label). A whole small parcel on a big one is neither.
   */
  const partOf = (weak: Detection, sure: Detection) => {
    const share = area(weak.box) / (area(sure.box) || 1);
    return inside(weak.box, sure.box) > 0.4 && (share >= 0.25 || share < 0.05);
  };
  /** Two or more distinct, sure enough parcels inside d that fill most of it. */
  const isGroup = (d: Detection) => {
    const parts: Detection[] = [];
    const candidates = detections
      .filter(p => p !== d && p.score >= GROUP_PART && !floor(p))
      .filter(p => area(p.box) < 0.75 * area(d.box) && inside(p.box, d.box) > 0.7)
      .sort((a, b) => b.score - a.score);
    for (const p of candidates) if (!parts.some(q => sameParcel(p, q))) parts.push(p);
    const filled = parts.reduce((sum, p) => sum + area(p.box) * inside(p.box, d.box), 0);
    return parts.length >= 2 && filled >= 0.5 * area(d.box);
  };
  for (const d of [...detections].sort((a, b) => b.score - a.score)) {
    if (floor(d)) skipped.push({ detection: d, reason: 'floor' });
    else if (isGroup(d)) skipped.push({ detection: d, reason: 'group' });
    else if (kept.some(k => sameParcel(d, k))) skipped.push({ detection: d, reason: 'duplicate' });
    else if (d.score < WEAK_PARCEL && kept.some(k => partOf(d, k)))
      skipped.push({ detection: d, reason: 'weak' });
    else kept.push(d);
  }
  return { kept, skipped };
}
