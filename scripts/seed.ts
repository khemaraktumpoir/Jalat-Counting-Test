/**
 * Seeds one camera on the sample video (samples/conveyor-synthetic.mp4) with a counting line across
 * the belt, so the service has something to run on day one. Start the service once first (DB_SYNC
 * creates the tables). Re-running leaves an existing "Sample conveyor" as it is.
 *
 *   yarn db:seed                     # a camera for Operation (no warehouse)
 *   yarn db:seed --warehouse=<id>    # a camera of that mobile warehouse (its user id)
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { Client } from 'pg';

const env: Record<string, string> = Object.fromEntries(
  (existsSync('.env') ? readFileSync('.env', 'utf8') : '')
    .split(/\r?\n/)
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
);
const warehouseId = process.argv.find(a => a.startsWith('--warehouse='))?.slice('--warehouse='.length) || null;

async function main(): Promise<void> {
  const client = new Client({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_SCHEMA
  });
  await client.connect();
  try {
    const existing = await client.query(`SELECT id FROM "CountingCameras" WHERE name = 'Sample conveyor' LIMIT 1`);
    if (existing.rows.length) {
      console.log(`Sample conveyor already there: ${existing.rows[0].id}`);
      return;
    }
    const video = resolve('samples', 'conveyor-synthetic.mp4');
    const { rows } = await client.query(
      `INSERT INTO "CountingCameras" (name, "sourceUrl", enabled, fps, "confThreshold", classes, width, height, loop, "warehouseId", "createdBy")
       VALUES ('Sample conveyor', $1, false, 10, 0.4, '{}', 1280, 720, true, $2, 'seed')
       RETURNING id`,
      [video, warehouseId]
    );
    const cameraId = rows[0].id;
    // Across the belt at mid-height, drawn right → left: IN is downwards (the left of the line).
    await client.query(
      `INSERT INTO "CountingRegions" ("cameraId", type, points, "updatedBy") VALUES ($1, 'LINE', $2, 'seed')`,
      [cameraId, JSON.stringify([{ x: 960, y: 360 }, { x: 320, y: 360 }])]
    );
    console.log(`Sample conveyor: ${cameraId} (${video}), line across the belt. Start it from the app or startCountingCamera.`);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
