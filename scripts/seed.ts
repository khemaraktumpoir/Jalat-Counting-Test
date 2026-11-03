/**
 * Adds the cameras of test-videos/cameras.json, the site camera list: the warehouses' network
 * cameras (brand, IP, channel, stream; the password from .env) and the test videos (each with its
 * line or area and the counts one play gives). Start the service once first (DB_SYNC creates the
 * tables). A camera already there (by name) keeps its settings; only its address (a new IP or
 * password, an old absolute video path) and its detector follow the file. New cameras are added
 * switched off unless the entry says "enabled": true: start them from the app.
 *
 *   yarn db:seed                     # each camera to its entry's warehouseId, else Operation's (none)
 *   yarn db:seed --warehouse=<id>    # the cameras without a warehouseId go to that mobile warehouse
 *   yarn db:seed --only=chair,lane   # only the entries whose name contains one of these
 *
 * Also says which cameras play a video file that is no longer there.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { Client } from 'pg';

import { NetworkCamera, networkCameraUrl } from '../src/lib/inference/camera-url';

// .env, with the environment's own values first (e.g. DB_HOST=localhost DB_PORT=5433 for the
// Docker database, CAM_ZONE_A_PASSWORD=… for a camera).
const env: Record<string, string | undefined> = {
  ...Object.fromEntries(
    (existsSync('.env') ? readFileSync('.env', 'utf8') : '')
      .split(/\r?\n/)
      .filter(l => /^[A-Z0-9_]+=/.test(l))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
  ),
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith('DB_') || key.startsWith('CAM_'))
  )
};
const defaultWarehouseId =
  process.argv.find(a => a.startsWith('--warehouse='))?.slice('--warehouse='.length) || null;
/** --only=<name>,<name>: only the entries whose name contains one of these (case ignored). */
const only = (process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

/** One entry of test-videos/cameras.json: a network camera (`camera`) or a test video (`sourceUrl`). */
interface CameraEntry {
  name: string;
  /** The mobile warehouse (its user id) the camera belongs to; else --warehouse, else Operation's. */
  warehouseId?: string | null;
  /** The warehouse's name, for people reading the file (e.g. "TEST WH 66"). */
  warehouse?: string;
  /** A network camera: built into rtsp://… as the app's form does (password from .env). */
  camera?: NetworkCamera;
  /** A test video, relative to the service's folder (the same row plays here and in Docker). */
  sourceUrl?: string;
  about?: string;
  fps: number;
  confThreshold: number;
  /** The picture size the region is drawn in (a camera's small stream: e.g. 640×360). */
  width: number;
  height: number;
  /** A video file: start again at its end. */
  loop?: boolean;
  /** Its detector instead of the service's MODEL_PATH: demo:orange for the synthetic videos. */
  model?: string | null;
  /** A LINE (2 points: IN is a crossing to the left of a → b) or a POLYGON (3 or more: IN entering). Left out: draw it in the app on the camera's picture. */
  region?: { type: 'LINE' | 'POLYGON'; points: { x: number; y: number }[] };
  /** A test video: what one play counts with MODEL_PATH=demo:orange. */
  expected?: { in: number; out: number };
  /** Started as soon as it is added (default: off). */
  enabled?: boolean;
}
const CAMERAS_FILE = 'test-videos/cameras.json';

/** An address to print: the password hidden. */
const masked = (url: string) => url.replace(/^(rtsp:\/\/[^:@/]*:)[^@/]*@/i, '$1•••@');

/** The entry's address, or why it cannot be added. */
function sourceOf(entry: CameraEntry): string {
  if (entry.camera) return networkCameraUrl(entry.camera, env);
  if (!entry.sourceUrl) throw new Error('it has neither "camera" nor "sourceUrl".');
  if (!existsSync(resolve(entry.sourceUrl)))
    throw new Error(`${entry.sourceUrl} is missing (run the seed from the service folder).`);
  return entry.sourceUrl;
}

async function seedCamera(client: Client, entry: CameraEntry): Promise<void> {
  let source: string;
  try {
    source = sourceOf(entry);
  } catch (error: any) {
    console.log(`- ${entry.name}: not added: ${error.message}`);
    return;
  }
  const existing = await client.query(
    `SELECT id, "sourceUrl", model FROM "CountingCameras" WHERE name = $1 LIMIT 1`,
    [entry.name]
  );
  if (existing.rows.length) {
    const [row] = existing.rows;
    const changes: string[] = [];
    // Its address as the file says now (a new IP or password; an old absolute video path).
    if (row.sourceUrl !== source) {
      await client.query(`UPDATE "CountingCameras" SET "sourceUrl" = $2 WHERE id = $1`, [
        row.id,
        source
      ]);
      changes.push(`address now ${masked(source)}`);
    }
    // Its detector as the file says.
    const model = entry.model ?? null;
    if ((row.model ?? null) !== model) {
      await client.query(`UPDATE "CountingCameras" SET model = $2 WHERE id = $1`, [row.id, model]);
      changes.push(`model now ${model ?? "the service's"}`);
    }
    console.log(
      changes.length
        ? `${entry.name}: ${changes.join(', ')} (restart the camera to use it).`
        : `${entry.name}: already there (${row.id}).`
    );
    return;
  }
  const { rows } = await client.query(
    // warehouseIds too: the service checks it when a camera is opened (warehouseId is its first, for old clients).
    `INSERT INTO "CountingCameras" (name, "sourceUrl", enabled, fps, "confThreshold", classes, width, height, loop, model, "warehouseId", "warehouseIds", "createdBy")
     VALUES ($1, $2, $3, $4, $5, '{}', $6, $7, $8, $9, $10::varchar, CASE WHEN $10::varchar IS NULL THEN '{}'::varchar[] ELSE ARRAY[$10::varchar] END, 'seed')
     RETURNING id`,
    [
      entry.name,
      source,
      entry.enabled ?? false,
      entry.fps,
      entry.confThreshold,
      entry.width,
      entry.height,
      entry.loop ?? true,
      entry.model ?? null,
      entry.warehouseId ?? defaultWarehouseId
    ]
  );
  if (entry.region)
    await client.query(
      `INSERT INTO "CountingRegions" ("cameraId", type, points, "updatedBy") VALUES ($1, $2, $3, 'seed')`,
      [rows[0].id, entry.region.type, JSON.stringify(entry.region.points)]
    );
  const counts = entry.expected
    ? `; one play counts IN ${entry.expected.in} / OUT ${entry.expected.out}`
    : '';
  console.log(
    `${entry.name}: ${rows[0].id} (${masked(source)}), ${
      entry.region ? `${entry.region.type} region` : 'no region yet: draw it in the app'
    }${counts}.`
  );
}

async function main(): Promise<void> {
  const cameras: CameraEntry[] = (
    JSON.parse(readFileSync(CAMERAS_FILE, 'utf8')) as CameraEntry[]
  ).filter(c => !only.length || only.some(o => c.name.toLowerCase().includes(o)));
  if (only.length && !cameras.length)
    throw new Error(`No camera in cameras.json matches --only=${only.join(',')}.`);
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_SCHEMA
  });
  await client.connect();
  try {
    for (const camera of cameras) await seedCamera(client, camera);
    // Cameras on a video file that is gone (e.g. conveyor-synthetic.mp4, deleted 28 Oct 2026).
    const files = await client.query(
      `SELECT id, name, "sourceUrl" FROM "CountingCameras" WHERE "sourceUrl" LIKE 'test-videos/%'`
    );
    for (const row of files.rows)
      if (!existsSync(resolve(row.sourceUrl)))
        console.log(
          `! ${row.name} (${row.id}) plays ${row.sourceUrl}, which is gone: delete it or give it another source.`
        );
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
