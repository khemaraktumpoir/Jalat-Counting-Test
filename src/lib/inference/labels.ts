import { readFileSync } from 'fs';

/**
 * models/classes.json: the model's class index → label, as an array (["person", "bicycle", …])
 * or an object ({ "0": "parcel" }).
 */
/**
 * Classes that share a label count as one: each such id → the first id with its label. The parcel
 * model is told several words for one thing (parcel, mailer bag, gift bag, box…), all labelled
 * "parcel": every one of them is then class 0, so a camera keeping class 0 counts them all.
 * {} when every label differs (the model's classes are used as they are).
 */
export function foldClasses(labels: Record<number, string>): Record<number, number> {
  const first = new Map<string, number>();
  const fold: Record<number, number> = {};
  for (const id of Object.keys(labels)
    .map(Number)
    .sort((a, b) => a - b)) {
    const at = first.get(labels[id]);
    if (at === undefined) first.set(labels[id], id);
    else fold[id] = at;
  }
  return fold;
}

export function loadLabels(path: string): Record<number, string> {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(raw))
    return Object.fromEntries(raw.map((label: string, i: number) => [i, String(label)]));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [Number(k), String(v)]));
}
