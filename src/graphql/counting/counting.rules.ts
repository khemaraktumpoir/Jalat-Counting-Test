import { E } from '@common';
import { foldClasses } from '@lib/inference';

export interface PointLike {
  x: number;
  y: number;
}

/**
 * Why a region cannot be saved, or null when it is fine: a line has exactly 2 points, an area 3 or
 * more, every point inside the camera's width × height, and no zero-length line.
 */
export function regionProblem(
  type: E.RegionTypeEnum,
  points: PointLike[],
  width: number,
  height: number
): string | null {
  if (type === E.RegionTypeEnum.LINE && points.length !== 2)
    return 'A counting line needs exactly 2 points.';
  if (type === E.RegionTypeEnum.POLYGON && points.length < 3)
    return 'A counting area needs at least 3 points.';
  const outside = points.findIndex(p => !(p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height));
  if (outside >= 0)
    return `Point ${outside + 1} is outside the camera image (${width} × ${height}).`;
  if (
    type === E.RegionTypeEnum.LINE &&
    points[0].x === points[1].x &&
    points[0].y === points[1].y
  ) {
    return 'The two points of a line must differ.';
  }
  return null;
}

/** Labels as a sorted list (countingClasses); a label shared by several classes once, as its first (foldClasses). */
export const classList = (labels: Record<number, string>) => {
  const fold = foldClasses(labels);
  return Object.entries(labels)
    .map(([id, label]) => ({ id: Number(id), label }))
    .filter(({ id }) => fold[id] === undefined)
    .sort((a, b) => a.id - b.id);
};

/** { label: { in, out } } → [{ label, in, out }], biggest first. */
export const byClassList = (byClass: Record<string, { in: number; out: number }>) =>
  Object.entries(byClass ?? {})
    .map(([label, v]) => ({ label, in: v.in, out: v.out }))
    .sort((a, b) => b.in + b.out - (a.in + a.out));

/** "HH:mm", 00:00–23:59: a schedule's start or end time. */
export const SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The time of day now in the warehouses' time zone (C.TIME_ZONE), as "HH:mm". */
export function timeOfDay(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(now);
}

/**
 * Whether a camera may count at `time` ("HH:mm"): always without a schedule (no start or end), else
 * from its start up to (not at) its end; an end before the start runs over midnight (22:00–06:00).
 */
export function inSchedule(
  schedule: { startTime?: string | null; endTime?: string | null },
  time: string
): boolean {
  const { startTime, endTime } = schedule;
  if (!startTime || !endTime || startTime === endTime) return true;
  return startTime < endTime
    ? time >= startTime && time < endTime
    : time >= startTime || time < endTime;
}
