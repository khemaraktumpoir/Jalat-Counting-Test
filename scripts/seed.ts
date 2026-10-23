/**
 * Seeds one camera on the sample video (samples/conveyor-synthetic.mp4) with a counting line across
 * the belt, so the service has something to run on day one. Start the service once first (DB_SYNC
 * creates the tables). Re-running leaves an existing "Sample conveyor" as it is (an old absolute
 * path to the sample video is made relative).
 *
 *   yarn db:seed                     # a camera for Operation (no warehouse)
 *   yarn db:seed --warehouse=<id>    # a camera of that mobile warehouse (its user id)
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { Client } from 'pg';

// .env, with the environment's own values first (e.g. DB_HOST=localhost DB_PORT=5433 for the Docker database).
const env: Record<string, string | undefined> = {
  ...Object.fromEntries(
    (existsSync('.env') ? readFileSync('.env', 'utf8') : '')
      .split(/\r?\n/)
      .filter(l => /^[A-Z_]+=/.test(l))
      .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')])
  ),
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('DB_')))
};
const warehouseId =
  process.argv.find(a => a.startsWith('--warehouse='))?.slice('--warehouse='.length) || null;

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
    // Relative to the service's folder, so the same row plays on this machine and in Docker
    // (docker-compose.yml mounts ./samples): an absolute path only works where the seed ran.
    const video = 'samples/conveyor-synthetic.mp4';
    if (!existsSync(resolve(video)))
      throw new Error(`${video} is missing: run the seed from the service folder.`);
    const existing = await client.query(
      `SELECT id, "sourceUrl" FROM "CountingCameras" WHERE name = 'Sample conveyor' LIMIT 1`
    );
    if (existing.rows.length) {
      const [camera] = existing.rows;
      // An older seed saved this machine's absolute path: the sample's relative one instead.
      if (camera.sourceUrl !== video && /conveyor-synthetic\.mp4$/.test(camera.sourceUrl)) {
        await client.query(`UPDATE "CountingCameras" SET "sourceUrl" = $2 WHERE id = $1`, [
          camera.id,
          video
        ]);
        console.log(
          `Sample conveyor already there: ${camera.id} — its video is now ${video} (was ${camera.sourceUrl}).`
        );
        return;
      }
      console.log(`Sample conveyor already there: ${camera.id}`);
      return;
    }
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
      [
        cameraId,
        JSON.stringify([
          { x: 960, y: 360 },
          { x: 320, y: 360 }
        ])
      ]
    );
    console.log(
      `Sample conveyor: ${cameraId} (${video}), line across the belt. Start it from the app or startCountingCamera.`
    );
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
