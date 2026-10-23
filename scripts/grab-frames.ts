/**
 * Saves still frames for labelling a parcel dataset, one JPEG every `--every` seconds, into
 * training/datasets/parcels/unlabeled.
 *
 * From a camera of the service (the usual way): through its API, GET
 * /api/v1/counting/cameras/:id/snapshot — the same frame the camera page shows, whatever the
 * source (RTSP, a phone camera app, a phone in the warehouse app, a video file), with the same
 * sign-in and warehouse checks. A running camera answers with its last frame at once.
 *
 *   yarn frames:grab --camera 47d55c48-… --every 2 --minutes 10 --token <access token>
 *   COUNTING_TOKEN=… COUNTING_API_URL=https://counting-dev.jalatlogistics.com yarn frames:grab --camera …
 *
 * From an address or a file, read directly with ffmpeg (no service needed):
 *
 *   yarn frames:grab rtsp://user:pass@192.168.1.20:554/stream1 --every 2 --minutes 10
 *   yarn frames:grab recordings/belt1.mp4 --every 0.5 --prefix belt1
 *
 * --camera <id>    a camera of the service; the token: --token or COUNTING_TOKEN (a Jalat sign-in
 *                  of ADMIN, OPERATION or MOBILE_WAREHOUSE); the service: --api or COUNTING_API_URL
 *                  (default http://localhost:<PORT from .env, 9096>)
 * --every 2        seconds between frames (default 2)
 * --minutes 10     how long (default 10); a video file read directly stops at its end
 * --prefix name    file name prefix (default: the camera id or the date and time)
 * --out dir        another folder
 */
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { resolveFfmpeg } from '@lib/inference';

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

function envValue(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find(l => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Through the service: GET …/snapshot every `every` s for `minutes`. */
async function grabFromCamera(
  cameraId: string,
  opts: { every: number; minutes: number; out: string; prefix: string; argv: string[] }
): Promise<number> {
  const token = option(opts.argv, 'token') ?? envValue('COUNTING_TOKEN');
  if (!token) throw new Error('No token: pass --token <access token> or set COUNTING_TOKEN.');
  const api = (
    option(opts.argv, 'api') ??
    envValue('COUNTING_API_URL') ??
    `http://localhost:${envValue('PORT') ?? 9096}`
  ).replace(/\/$/, '');
  const url = `${api}/api/v1/counting/cameras/${encodeURIComponent(cameraId)}/snapshot`;
  console.log(
    `Grabbing a frame every ${opts.every} s from camera ${cameraId} (${api}) for ${opts.minutes} min → ${opts.out}`
  );

  const until = Date.now() + opts.minutes * 60_000;
  let saved = 0;
  let failures = 0;
  while (Date.now() < until) {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        const message = body?.message ?? `HTTP ${response.status}`;
        // Signed out, no access, no such camera: asking again will not help.
        if ([401, 403, 404].includes(response.status) && !/picture from the phone/i.test(message))
          throw Object.assign(new Error(message), { fatal: true });
        throw new Error(message);
      }
      saved += 1;
      failures = 0;
      const file = resolve(opts.out, `${opts.prefix}_${String(saved).padStart(5, '0')}.jpg`);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      process.stdout.write(`\r${saved} frames`);
    } catch (error: any) {
      if (error.fatal) throw error;
      failures += 1;
      console.warn(`\nNo frame (${failures}): ${error.message}`);
      if (failures >= 10) throw new Error('10 failures in a row: stopping.');
    }
    await sleep(Math.max(0, opts.every * 1000 - (Date.now() - started)));
  }
  process.stdout.write('\n');
  return saved;
}

/** Directly with ffmpeg: an rtsp / http address or a video file. */
async function grabFromSource(
  source: string,
  opts: { every: number; minutes: number; out: string; prefix: string }
): Promise<number> {
  const isStream = /^(rtsp|rtmp|http|https):\/\//i.test(source);
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    ...(/^rtsp:\/\//i.test(source) ? ['-rtsp_transport', 'tcp'] : []),
    '-i', source,
    ...(isStream ? ['-t', String(opts.minutes * 60)] : []),
    '-vf', `fps=1/${opts.every}`,
    '-q:v', '2',
    resolve(opts.out, `${opts.prefix}_%05d.jpg`)
  ]; // prettier-ignore
  console.log(
    `Grabbing a frame every ${opts.every} s from ${source}${
      isStream ? ` for ${opts.minutes} min` : ''
    } → ${opts.out}`
  );
  const before = readdirSync(opts.out).length;
  await new Promise<void>((done, fail) => {
    const child = spawn(resolveFfmpeg(process.env.FFMPEG_PATH), args, { stdio: 'inherit' });
    child.on('error', fail);
    child.on('close', code =>
      code === 0 ? done() : fail(new Error(`ffmpeg exited with ${code}`))
    );
  });
  return readdirSync(opts.out).length - before;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cameraId = option(argv, 'camera');
  const source = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined;
  if (!cameraId && !source) {
    console.error(
      'Usage: yarn frames:grab --camera <id> [--token …]   or   yarn frames:grab <rtsp://… | video file>'
    );
    process.exit(1);
  }
  const every = Math.max(0.1, Number(option(argv, 'every') ?? 2));
  const minutes = Number(option(argv, 'minutes') ?? 10);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const prefix = option(argv, 'prefix') ?? (cameraId ? `${cameraId.slice(0, 8)}_${stamp}` : stamp);
  const out = resolve(option(argv, 'out') ?? 'training/datasets/parcels/unlabeled');
  mkdirSync(out, { recursive: true });

  const opts = { every, minutes, out, prefix };
  const saved = cameraId
    ? await grabFromCamera(cameraId, { ...opts, argv })
    : await grabFromSource(source!, opts);
  console.log(`Saved ${saved} frames. Next: label them (training/README.md).`);
}

main().catch(error => {
  console.error(error.message ?? error);
  process.exit(1);
});
