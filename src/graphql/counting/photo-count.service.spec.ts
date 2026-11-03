import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { encode as encodeJpeg } from 'jpeg-js';
import { tmpdir } from 'os';
import { join } from 'path';

import { DEMO_LABELS, DEMO_MODEL } from '@lib/counting';
import { fingerprintDistance, fitSize, scaleRgb } from '@lib/inference';

import {
  markCopies,
  PhotoCountService,
  sortParcels,
  sumByClass,
  tidyParcels
} from './photo-count.service';

/**
 * A photo with `boxes` orange squares (what the demo detector counts), as a JPEG. `scene` gives
 * each photo its own floor (a gradient running a different way) and box row, as real photos are;
 * `mark` draws a thick line across it, as someone marking a copy with an X.
 */
function photo(width: number, height: number, boxes: number, scene = 0, mark = false): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      // stripes across the photo, a different width for each scene
      const t = 0.5 + 0.5 * Math.sin(((x + y / 3) * (scene + 1) * 2 * Math.PI) / width);
      const g = Math.round(40 + 120 * t);
      rgba.set([g, g, g, 255], (y * width + x) * 4);
    }
  const top = 60 + (scene % 3) * 60;
  for (let b = 0; b < boxes; b++) {
    const left = 40 + b * 180;
    for (let y = top; y < top + 120; y++)
      for (let x = left; x < left + 120; x++) rgba.set([247, 148, 31, 255], (y * width + x) * 4);
  }
  if (mark)
    for (let x = 0; x < width; x++)
      for (let t = -6; t <= 6; t++) {
        const y = Math.round((x * height) / width) + t;
        if (y >= 0 && y < height) rgba.set([250, 210, 0, 255], (y * width + x) * 4);
      }
  return encodeJpeg({ data: rgba, width, height }, 90).data;
}

function service(roots: string, loaded = true, env: Record<string, unknown> = {}) {
  const inference = {
    modelPath: DEMO_MODEL,
    modelLoaded: loaded,
    modelError: loaded ? null : 'Model not found',
    labels: DEMO_LABELS,
    ffmpegPath: 'ffmpeg'
  };
  // No parcel model here: these tests count with the demo detector (the cameras' model).
  const config = {
    env: {
      PHOTO_ROOTS: roots,
      DEFAULT_CONF: 0.4,
      PHOTO_MODEL_PATH: 'no-parcel-model.onnx',
      PHOTO_EMBED_PATH: 'off',
      ...env
    }
  };
  return new PhotoCountService(inference as any, config as any);
}

describe('photo sizes', () => {
  it('fits a photo in 1600 px keeping its shape, never enlarging it', () => {
    expect(fitSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitSize(1080, 1920)).toEqual({ width: 900, height: 1600 });
    expect(fitSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('scales rgb pixels to the nearest pixel', () => {
    const rgb = new Uint8Array([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]); // 2 × 2
    expect(Array.from(scaleRgb(rgb, 2, 2, 1, 1))).toEqual([1, 1, 1]);
    expect(scaleRgb(rgb, 2, 2, 2, 2)).toBe(rgb);
  });
});

describe('PhotoCountService', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'photos-'));
    mkdirSync(join(dir, 'batch'));
    writeFileSync(join(dir, 'batch', 'b-2.jpg'), photo(640, 360, 2, 1));
    writeFileSync(join(dir, 'batch', 'b-10.jpg'), photo(640, 360, 3, 2));
    writeFileSync(join(dir, 'batch', 'b-1.jpeg'), photo(640, 360, 0, 3));
    mkdirSync(join(dir, 'copies'));
    writeFileSync(join(dir, 'copies', 'c-1.jpg'), photo(640, 360, 3, 1));
    writeFileSync(join(dir, 'copies', 'c-2.jpg'), photo(640, 360, 2, 2));
    writeFileSync(join(dir, 'copies', 'c-3.jpg'), photo(640, 360, 3, 1, true));
    writeFileSync(join(dir, 'batch', 'broken.jpg'), Buffer.from('not a jpeg'));
    writeFileSync(join(dir, 'batch', 'notes.txt'), 'not a photo');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('counts the objects in one photo, by label, with boxes as fractions', async () => {
    const result = await service(dir).countJpeg(photo(640, 360, 3), 'IMG_1.jpg');
    expect(result).toMatchObject({
      name: 'IMG_1.jpg',
      width: 640,
      height: 360,
      count: 3,
      error: null
    });
    expect(result.byClass).toEqual([{ label: 'parcel', count: 3 }]);
    for (const box of result.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(1);
      expect(box.label).toBe('parcel');
    }
  });

  it('counts a folder by name (numbers in order), skips other files, and keeps a broken photo apart', async () => {
    const result = await service(dir).countFolder(join(dir, 'batch'));
    expect(result.photos.map(p => p.name)).toEqual([
      'b-1.jpeg',
      'b-2.jpg',
      'b-10.jpg',
      'broken.jpg'
    ]);
    expect(result.photos.map(p => p.count)).toEqual([0, 2, 3, 0]);
    expect(result.photos[3].error).toBeTruthy();
    expect(result).toMatchObject({ total: 5, counted: 3, failed: 1, more: false });
    expect(result.byClass).toEqual([{ label: 'parcel', count: 5 }]);
  });

  it('marks a copy of an earlier photo (the same scene, marked with a line) and leaves it out of the total', async () => {
    const result = await service(dir).countFolder(join(dir, 'copies'));
    expect(result.photos.map(p => [p.name, p.count, p.copyOf])).toEqual([
      ['c-1.jpg', 3, null],
      ['c-2.jpg', 2, null],
      ['c-3.jpg', 3, 'c-1.jpg']
    ]);
    expect(result).toMatchObject({ total: 5, counted: 2, copies: 1, failed: 0 });
    for (const p of result.photos) expect(p.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tells copies from other photos by their fingerprints', async () => {
    const photos = service(dir);
    const [a, b, c] = await Promise.all([
      photos.countJpeg(photo(640, 360, 3, 1), 'a.jpg'),
      photos.countJpeg(photo(640, 360, 3, 1, true), 'b.jpg'),
      photos.countJpeg(photo(640, 360, 2, 2), 'c.jpg')
    ]);
    expect(fingerprintDistance(a.fingerprint, b.fingerprint)).toBeLessThanOrEqual(40);
    expect(fingerprintDistance(a.fingerprint, c.fingerprint)).toBeGreaterThan(40);
    const list = [a, b, c].map(p => ({ ...p, copyOf: null as string | null }));
    markCopies(list);
    expect(list.map(p => p.copyOf)).toEqual([null, 'a.jpg', null]);
  });

  it('counts only up to the limit and says there are more', async () => {
    const result = await service(dir).countFolder(join(dir, 'batch'), {}, 2);
    expect(result.photos).toHaveLength(2);
    expect(result.more).toBe(true);
  });

  it('reads only inside PHOTO_ROOTS', () => {
    const photos = service(dir);
    expect(photos.resolveFolder(join(dir, 'batch'))).toBe(join(dir, 'batch'));
    expect(() => photos.resolveFolder(join(dir, '..'))).toThrow(/Only these folders/);
    expect(() => photos.resolveFolder(join(dir, 'batch', '..', '..', 'etc'))).toThrow(
      /Only these folders/
    );
    expect(() => photos.resolveFolder(join(dir, 'missing'))).toThrow(/No folder/);
  });

  it('says why when there is no model', async () => {
    const counting = service(dir, false).countJpeg(photo(64, 64, 0), 'x.jpg');
    await expect(counting).rejects.toThrow(/No model to count with: Model not found/);
    await expect(counting).rejects.toMatchObject({ status: 503 });
  });

  it('says "busy, try again" (429) past the photos one user may have waiting', async () => {
    const photos = service(dir, true, { PHOTO_QUEUE_PER_USER: 1 });
    const jpeg = photo(320, 240, 1);
    // The first is counted at once, the second waits, the third is one too many.
    const counted = [1, 2, 3].map(n =>
      photos.countJpeg(jpeg, `p-${n}.jpg`, {}, undefined, 'user-1')
    );
    await expect(counted[2]).rejects.toMatchObject({ status: 429 });
    // Another user still gets a turn.
    await expect(photos.countJpeg(jpeg, 'q.jpg', {}, undefined, 'user-2')).resolves.toMatchObject({
      count: 1
    });
    await expect(Promise.all(counted.slice(0, 2))).resolves.toHaveLength(2);
  });

  it('adds labels up over photos, the most first', () => {
    expect(
      sumByClass([
        { byClass: [{ label: 'bag', count: 1 }] },
        {
          byClass: [
            { label: 'parcel', count: 2 },
            { label: 'bag', count: 2 }
          ]
        }
      ])
    ).toEqual([
      { label: 'bag', count: 3 },
      { label: 'parcel', count: 2 }
    ]);
  });
});

describe('tidyParcels', () => {
  const d = (x1: number, y1: number, x2: number, y2: number, score: number) => ({
    box: { x1, y1, x2, y2 },
    score,
    classId: 0
  });

  it('keeps one box per parcel: the surer of two boxes that mostly overlap', () => {
    const kept = tidyParcels(
      [d(100, 100, 300, 300, 0.4), d(120, 110, 310, 290, 0.2), d(500, 100, 650, 260, 0.3)],
      1000,
      800
    );
    expect(kept.map(k => k.score)).toEqual([0.4, 0.3]);
  });

  it('drops a box over most of the photo (the floor), not the parcels on it', () => {
    const kept = tidyParcels([d(0, 0, 900, 700, 0.2), d(100, 100, 300, 300, 0.5)], 1000, 800);
    expect(kept.map(k => k.score)).toEqual([0.5]);
  });

  it('drops a weak guess lying mostly on a surer parcel, keeps a weak one on its own', () => {
    const kept = tidyParcels(
      [d(350, 860, 690, 1280, 0.58), d(220, 1100, 850, 1280, 0.07), d(410, 90, 740, 400, 0.06)],
      1280,
      1280
    );
    expect(kept.map(k => k.score)).toEqual([0.58, 0.06]);
  });

  it('says why each box was left out', () => {
    const { kept, skipped } = sortParcels(
      [
        d(0, 0, 900, 700, 0.2),
        d(100, 100, 300, 300, 0.5),
        d(110, 105, 290, 310, 0.3),
        d(180, 180, 340, 340, 0.07)
      ],
      1000,
      800
    );
    expect(kept.map(k => k.score)).toEqual([0.5]);
    expect(skipped.map(s => [s.detection.score, s.reason])).toEqual([
      [0.3, 'duplicate'],
      [0.2, 'floor'],
      [0.07, 'weak']
    ]);
  });

  it('keeps parcels lying next to each other', () => {
    expect(tidyParcels([d(0, 0, 200, 200, 0.5), d(150, 0, 350, 200, 0.5)], 1000, 800)).toHaveLength(
      2
    );
  });

  // From a real pickup pile (27 Oct 2026, photos/real-2026-10-27): the model's surest box went
  // round a yellow mailer and the mailer below it, and each mailer had a box of its own.
  it('drops one box around several parcels (a group) and counts the parcels in it', () => {
    const { kept, skipped } = sortParcels(
      [d(237, 533, 819, 1305, 0.55), d(194, 546, 695, 1004, 0.12), d(277, 976, 818, 1306, 0.09)],
      1200,
      1600
    );
    expect(kept.map(k => k.score)).toEqual([0.12, 0.09]);
    expect(skipped.map(s => [s.detection.score, s.reason])).toEqual([[0.55, 'group']]);
  });

  it('keeps a small parcel lying on a bigger one: not the same parcel boxed twice', () => {
    // A small mailer on a yellow one: 60 % of it lies inside, but it is a quarter of the size.
    const kept = tidyParcels([d(194, 546, 695, 1004, 0.5), d(539, 575, 796, 782, 0.3)], 1200, 1600);
    expect(kept).toHaveLength(2);
  });

  it('keeps a weak whole parcel on a sure one, drops a weak corner or label of it', () => {
    const sure = d(100, 100, 600, 600, 0.6);
    const smallParcel = d(400, 400, 520, 520, 0.05); // 6 % of the sure box: a parcel on it
    const corner = d(100, 100, 400, 400, 0.05); // 36 %: a corner of it
    const label = d(300, 300, 380, 360, 0.05); // 2 %: its sticker
    const { kept, skipped } = sortParcels([sure, smallParcel, corner, label], 1000, 1000);
    expect(kept).toEqual([sure, smallParcel]);
    expect(skipped.map(s => s.reason)).toEqual(['weak', 'weak']);
  });
});

describe('PhotoCountService records: copies across batches', () => {
  /** The records table in memory: what the service uses of the repository. */
  function memoryRecords() {
    const rows: any[] = [];
    let n = 0;
    return {
      rows,
      $recentFingerprints: async () =>
        rows.filter(r => r.fingerprint).sort((a, b) => a.createdAt - b.createdAt),
      create: (row: any) => ({ ...row }),
      save: async (row: any) => {
        const saved = { ...row, id: `r${++n}`, createdAt: new Date(Date.now() + n) };
        rows.push(saved);
        return saved;
      },
      // update(ids, change) or update({ field: value }, change), as TypeORM takes them.
      update: async (where: string[] | Record<string, unknown>, change: any) => {
        const match = (r: any) =>
          Array.isArray(where)
            ? where.includes(r.id)
            : Object.entries(where).every(([k, v]) => r[k] === v);
        for (const r of rows) if (match(r)) Object.assign(r, change);
      },
      findOne: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      delete: async (id: string) => {
        const i = rows.findIndex(r => r.id === id);
        if (i >= 0) rows.splice(i, 1);
      }
    };
  }
  const viewer = { id: 'wh-1', userType: 'MOBILE_WAREHOUSE' };
  function withRecords() {
    const records = memoryRecords();
    const inference = {
      modelPath: DEMO_MODEL,
      modelLoaded: true,
      modelError: null,
      labels: DEMO_LABELS,
      ffmpegPath: 'ffmpeg'
    };
    const config = {
      env: {
        DEFAULT_CONF: 0.4,
        PHOTO_MODEL_PATH: 'no-parcel-model.onnx',
        PHOTO_DUP_DAYS: 7,
        PHOTO_EMBED_PATH: 'off'
      }
    };
    return {
      records,
      photos: new PhotoCountService(inference as any, config as any, records as any)
    };
  }

  it('finds a photo sent again in a later batch, and says which one it repeats', async () => {
    const { records, photos } = withRecords();
    const first = await photos.countJpeg(
      photo(640, 360, 3, 1),
      'belt-03.jpg',
      {},
      { viewer, batchId: 'b1', seq: 0 }
    );
    const other = await photos.countJpeg(
      photo(640, 360, 2, 2),
      'belt-04.jpg',
      {},
      { viewer, batchId: 'b1', seq: 1 }
    );
    const again = await photos.countJpeg(
      photo(640, 360, 3, 1, true),
      'IMG_9.jpg',
      {},
      { viewer, batchId: 'b2', seq: 0 }
    );
    expect(first.copyOfRecord).toBeNull();
    expect(other.copyOfRecord).toBeNull();
    expect(again.copyOfRecord).toMatchObject({ name: 'belt-03.jpg', batchId: 'b1' });
    expect(records.rows.map(r => [r.name, r.copyOfId])).toEqual([
      ['belt-03.jpg', null],
      ['belt-04.jpg', null],
      ['IMG_9.jpg', first.recordId]
    ]);
  });

  it('in one batch keeps the photo picked first as the original, whichever finished first', async () => {
    const { records, photos } = withRecords();
    // seq 1 (the copy) is saved before seq 0 (the original)
    await photos.countJpeg(
      photo(640, 360, 3, 1, true),
      'second.jpg',
      {},
      { viewer, batchId: 'b1', seq: 1 }
    );
    const firstPicked = await photos.countJpeg(
      photo(640, 360, 3, 1),
      'first.jpg',
      {},
      { viewer, batchId: 'b1', seq: 0 }
    );
    expect(firstPicked.copyOfRecord).toBeNull();
    const second = records.rows.find(r => r.name === 'second.jpg');
    expect(second.copyOfId).toBe(firstPicked.recordId);
  });

  it('does not save without a batch', async () => {
    const { records, photos } = withRecords();
    const r = await photos.countJpeg(photo(640, 360, 1, 1), 'x.jpg');
    expect(r.recordId).toBeNull();
    expect(records.rows).toHaveLength(0);
  });
});

describe('PhotoCountService records: a photo counted again', () => {
  it('replaces its record (Retry), keeps the batch name, and is no copy of itself', async () => {
    const rows: any[] = [];
    let n = 0;
    const records = {
      $recentFingerprints: async () => rows.filter(r => r.fingerprint),
      create: (row: any) => ({ ...row }),
      save: async (row: any) => {
        const saved = { ...row, id: `r${++n}`, createdAt: new Date(Date.now() + n) };
        rows.push(saved);
        return saved;
      },
      update: async (where: any, change: any) => {
        for (const r of rows)
          if (
            Array.isArray(where)
              ? where.includes(r.id)
              : Object.entries(where).every(([k, v]) => r[k] === v)
          )
            Object.assign(r, change);
      },
      findOne: async ({ where }: any) =>
        rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null,
      delete: async (id: string) =>
        rows.splice(
          rows.findIndex(r => r.id === id),
          1
        )
    };
    const inference = {
      modelPath: DEMO_MODEL,
      modelLoaded: true,
      modelError: null,
      labels: DEMO_LABELS,
      ffmpegPath: 'ffmpeg'
    };
    const config = {
      env: { DEFAULT_CONF: 0.4, PHOTO_MODEL_PATH: 'no-parcel-model.onnx', PHOTO_EMBED_PATH: 'off' }
    };
    const photos = new PhotoCountService(inference as any, config as any, records as any);
    const viewer = { id: 'wh-1', userType: 'MOBILE_WAREHOUSE' } as any;
    const save = { viewer, batchId: 'b1', seq: 0, note: ' Truck 3 ' };
    await photos.countJpeg(photo(640, 360, 2, 1), 'a.jpg', {}, save);
    const again = await photos.countJpeg(photo(640, 360, 2, 1), 'a.jpg', {}, save);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: again.recordId, copyOfId: null, batchNote: 'Truck 3' });
    expect(again.copyOfRecord).toBeNull();
  });
});

describe('PhotoCountService records: the same parcel in two photos of a batch', () => {
  const viewer = { id: 'wh-1', userType: 'MOBILE_WAREHOUSE' } as any;
  function withBatch() {
    const at = new Date('2026-10-23T08:59:33Z');
    const rows: any[] = [
      {
        id: 'a',
        batchId: 'b1',
        seq: 0,
        name: '11-31-42.jpg',
        count: 5,
        byClass: [],
        copyOfId: null
      },
      {
        id: 'b',
        batchId: 'b1',
        seq: 1,
        name: '11-31-48.jpg',
        count: 7,
        byClass: [],
        copyOfId: null
      },
      { id: 'c', batchId: 'b1', seq: 2, name: 'copy.jpg', count: 7, byClass: [], copyOfId: 'b' },
      { id: 'x', batchId: 'b2', seq: 0, name: 'other.jpg', count: 3, byClass: [], copyOfId: null }
    ].map(r => ({
      ...r,
      ownerId: 'wh-1',
      createdAt: at,
      repeats: 0,
      repeatsOfId: null,
      added: 0,
      removed: 0
    }));
    const records = {
      rows,
      $visible: async (_: any, id: string) => rows.find(r => r.id === id) ?? null,
      $records: async (_: any, f: { batchId: string }) => rows.filter(r => r.batchId === f.batchId),
      $byIds: async (ids: string[]) => rows.filter(r => ids.includes(r.id)),
      update: async (id: string, change: any) =>
        Object.assign(
          rows.find(r => r.id === id),
          change
        )
    };
    const photos = new PhotoCountService({} as any, { env: {} } as any, records as any);
    return { rows, photos };
  }

  it('marks the repeats and names the photo that shows them', async () => {
    const { rows, photos } = withBatch();
    const record = await photos.markRepeats(viewer, { recordId: 'b', repeats: 1, ofRecordId: 'a' });
    expect(rows.find(r => r.id === 'b')).toMatchObject({ repeats: 1, repeatsOfId: 'a' });
    expect(record).toMatchObject({
      id: 'b',
      count: 7,
      repeats: 1,
      repeatsOf: { id: 'a', name: '11-31-42.jpg' }
    });
  });

  it('clears the mark with 0', async () => {
    const { rows, photos } = withBatch();
    await photos.markRepeats(viewer, { recordId: 'b', repeats: 1, ofRecordId: 'a' });
    await photos.markRepeats(viewer, { recordId: 'b', repeats: 0 });
    expect(rows.find(r => r.id === 'b')).toMatchObject({ repeats: 0, repeatsOfId: null });
  });

  it('refuses more repeats than parcels, another batch, a copy, or no photo', async () => {
    const { photos } = withBatch();
    await expect(
      photos.markRepeats(viewer, { recordId: 'b', repeats: 8, ofRecordId: 'a' })
    ).rejects.toThrow('at most 7');
    await expect(
      photos.markRepeats(viewer, { recordId: 'b', repeats: 1, ofRecordId: 'x' })
    ).rejects.toThrow('same batch');
    await expect(
      photos.markRepeats(viewer, { recordId: 'b', repeats: 1, ofRecordId: 'c' })
    ).rejects.toThrow('same batch');
    await expect(
      photos.markRepeats(viewer, { recordId: 'c', repeats: 1, ofRecordId: 'a' })
    ).rejects.toThrow('copy');
    await expect(photos.markRepeats(viewer, { recordId: 'b', repeats: 1 })).rejects.toThrow(
      'ofRecordId'
    );
  });
});

describe('PhotoCountService records: a photo fixed by hand', () => {
  const viewer = { id: 'wh-1', userType: 'MOBILE_WAREHOUSE' } as any;
  function withPhoto() {
    const rows: any[] = [
      {
        id: 'a',
        batchId: 'b1',
        seq: 0,
        name: '11-31-02.jpg',
        count: 3,
        byClass: [],
        copyOfId: null,
        ownerId: 'wh-1',
        createdAt: new Date(),
        repeats: 0,
        repeatsOfId: null,
        added: 0,
        removed: 0
      }
    ];
    const records = {
      $visible: async (_: any, id: string) => rows.find(r => r.id === id) ?? null,
      $records: async () => rows,
      $byIds: async () => [],
      update: async (id: string, change: any) =>
        Object.assign(
          rows.find(r => r.id === id),
          change
        )
    };
    return { rows, photos: new PhotoCountService({} as any, { env: {} } as any, records as any) };
  }

  it('keeps the parcels added and the boxes taken off', async () => {
    const { rows, photos } = withPhoto();
    const record = await photos.correctCount(viewer, { recordId: 'a', added: 1, removed: 2 });
    expect(rows[0]).toMatchObject({ added: 1, removed: 2 });
    expect(record).toMatchObject({ count: 3, added: 1, removed: 2 });
  });

  it('takes off at most what the model counted', async () => {
    const { photos } = withPhoto();
    await expect(
      photos.correctCount(viewer, { recordId: 'a', added: 0, removed: 4 })
    ).rejects.toThrow('at most 3');
    await expect(
      photos.correctCount(viewer, { recordId: 'x', added: 1, removed: 0 })
    ).rejects.toThrow('No such');
  });
});
