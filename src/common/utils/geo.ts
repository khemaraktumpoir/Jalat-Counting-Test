export interface GeoPoint {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_METERS = 6371000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line (Haversine) distance in meters between two points, rounded to the meter. */
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** Average urban driving speed for straight-line ETAs (as the Order Service's geo.ts): 30 km/h. */
const AVERAGE_SPEED_METERS_PER_SECOND = 30000 / 3600;

/** Minutes to drive the straight line between two points at 30 km/h; at least 1. */
export function etaMinutes(from: GeoPoint, to: GeoPoint): number {
  return Math.max(1, Math.round(distanceMeters(from, to) / AVERAGE_SPEED_METERS_PER_SECOND / 60));
}
