import { readFileSync } from 'fs';

/**
 * models/classes.json: the model's class index → label, as an array (["person", "bicycle", …])
 * or an object ({ "0": "parcel" }).
 */
export function loadLabels(path: string): Record<number, string> {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw))
    return Object.fromEntries(raw.map((label: string, i: number) => [i, String(label)]));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [Number(k), String(v)]));
}
