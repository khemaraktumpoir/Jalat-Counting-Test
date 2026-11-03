/**
 * This PC's webcam as a network camera, to try the counting without one. The local camera relay
 * (go2rtc in Docker, COMPOSE_PROFILES=relay) reads it as http://host.docker.internal:8555/cam2_sub
 * (deploy/go2rtc.local.yaml), and the counting service reads the relay as it would a real IP
 * camera: rtsp://go2rtc:8554/cam2_sub.
 *
 * The webcam is on only while it is watched: the relay asks for the picture when a camera on
 * cam2_sub starts (or its live view opens) and lets go when it stops, and this script then turns
 * the webcam on (ffmpeg, H.264 in MPEG-TS) and off again. In between it only waits.
 *
 *   yarn pc-camera                          # the first webcam, 640×360, 10 frames a second
 *   yarn pc-camera --camera "USB Camera"    # another one (yarn pc-camera --list shows them)
 *   yarn pc-camera --size 1280x720 --fps 5
 *   yarn pc-camera --background             # the same, hidden: no window to keep open
 *   yarn pc-camera --status | --stop        # is it running, is the webcam on? / stop the hidden one
 *
 * Leave it running (Ctrl+C stops it), or start it with --background (its log: pc-camera.log in the
 * temp folder, --status says where). Each start first ends what an earlier run left: its hidden
 * copy, and any ffmpeg still reading this webcam (a closed window can leave one, and it keeps the
 * webcam busy). In the app the camera is "PC webcam" from test-videos/cameras.json (yarn db:seed),
 * or: Network camera → Relay (go2rtc), host go2rtc, channel 2, small stream. Windows only
 * (DirectShow); on a Mac use -f avfoundation.
 *
 * --camera name    the webcam's name (default: the first one)
 * --size 640x360   picture size; the webcam must offer it (--list shows each one's sizes)
 * --fps 10         frames a second sent (the webcam may film faster: the rest are dropped)
 * --stream name    the path the relay asks for (default cam2_sub, as in deploy/go2rtc.local.yaml)
 * --port 8555      where the relay asks (this PC only: 127.0.0.1)
 * --list           the webcams and their sizes, then stop
 * --background     run hidden (the other options are passed on)
 * --stop           stop the hidden one, and the webcam
 * --status         whether one is running, the webcam on, and where its log is
 */
import { ChildProcess, spawn, spawnSync } from 'child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { createServer, ServerResponse } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';

import { resolveFfmpeg } from '@lib/inference';

/** What ffmpeg says about a webcam's pictures that does no harm (not shown). */
const HARMLESS =
  /unable to decode APP fields|Last message repeated|deprecated pixel format|non monotonically increasing dts/;

function option(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** What ffmpeg prints about DirectShow devices (it "fails": there is no input, only the list). */
function dshow(ffmpeg: string, args: string[]): string {
  return (
    spawnSync(ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8', windowsHide: true }).stderr ??
    ''
  );
}

function webcams(ffmpeg: string): string[] {
  const out = dshow(ffmpeg, ['-list_devices', 'true', '-f', 'dshow', '-i', 'dummy']);
  return [...out.matchAll(/"([^"]+)" \(video\)/g)].map(m => m[1]);
}

/** The webcam's sizes, as "640x360 (30 fps)". */
function sizesOf(ffmpeg: string, camera: string): string[] {
  const out = dshow(ffmpeg, ['-list_options', 'true', '-f', 'dshow', '-i', `video=${camera}`]);
  const sizes = new Map<string, number>();
  for (const m of out.matchAll(/max s=(\d+x\d+) fps=([\d.]+)/g))
    sizes.set(m[1], Math.max(sizes.get(m[1]) ?? 0, Number(m[2])));
  return [...sizes].map(([size, fps]) => `${size} (${fps} fps)`);
}

/** The hidden run (--background): its process id and its log, in the temp folder. */
const PID_FILE = join(tmpdir(), 'jalat-pc-camera.pid');
const LOG_FILE = join(tmpdir(), 'pc-camera.log');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The hidden run's process id, when it is still running. */
function backgroundPid(): number | null {
  const pid = existsSync(PID_FILE) ? Number(readFileSync(PID_FILE, 'utf8')) : NaN;
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
}

/** ffmpeg processes reading a webcam (DirectShow): this script's, the webcam on. */
function webcamFfmpegs(): number[] {
  const out = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | Where-Object { $_.CommandLine -match '-f dshow' -and $_.CommandLine -notmatch 'list_' } | ForEach-Object { $_.ProcessId }"
    ],
    { encoding: 'utf8', windowsHide: true }
  ).stdout;
  return (out ?? '')
    .split(/\s+/)
    .map(Number)
    .filter(pid => pid > 0);
}

/** Ends an earlier run: its hidden copy, and any ffmpeg of ours still holding the webcam. */
function stopEarlier(): number {
  let stopped = 0;
  const pid = backgroundPid();
  if (pid && pid !== process.pid) {
    process.kill(pid);
    stopped += 1;
  }
  for (const ffmpegPid of webcamFfmpegs()) {
    try {
      process.kill(ffmpegPid);
      stopped += 1;
    } catch {
      // already gone
    }
  }
  if (existsSync(PID_FILE) && backgroundPid() === null) unlinkSync(PID_FILE);
  return stopped;
}

/** Starts this script again, hidden and on its own (it outlives this window), logging to LOG_FILE. */
function startInBackground(argv: string[]): void {
  stopEarlier();
  const log = openSync(LOG_FILE, 'a');
  const child = spawn(
    process.execPath,
    [...process.execArgv, process.argv[1], ...argv.filter(a => a !== '--background'), '--hidden'],
    {
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
      cwd: process.cwd(),
      env: process.env
    }
  );
  child.unref();
  closeSync(log);
  writeFileSync(PID_FILE, String(child.pid));
  console.log(`Waiting in the background for the relay (process ${child.pid}).`);
  console.log('  The webcam turns on when a camera on cam2 starts, and off when it stops.');
  console.log(`  Log: ${LOG_FILE}`);
  console.log('  yarn pc-camera --status   running? webcam on?   yarn pc-camera --stop   stop it');
}

function main(): void {
  const argv = process.argv.slice(2);
  if (process.platform !== 'win32') {
    console.error('yarn pc-camera reads a webcam through DirectShow: Windows only.');
    process.exit(1);
  }
  if (argv.includes('--stop')) {
    const stopped = stopEarlier();
    console.log(stopped ? 'Stopped: the webcam is off.' : 'Nothing was running.');
    return;
  }
  if (argv.includes('--status')) {
    const pid = backgroundPid();
    const on = webcamFfmpegs().length > 0;
    console.log(
      pid
        ? `Running in the background (process ${pid}); the webcam is ${
            on ? 'on: a camera is watching' : 'off: nothing is watching'
          }.`
        : on
        ? 'Running from a window; the webcam is on.'
        : 'Not running in the background: yarn pc-camera --background'
    );
    console.log(`  Log: ${LOG_FILE}`);
    return;
  }
  if (argv.includes('--background')) return startInBackground(argv);
  const hidden = argv.includes('--hidden');
  const ffmpeg = resolveFfmpeg(process.env.FFMPEG_PATH);
  const found = webcams(ffmpeg);
  if (argv.includes('--list')) {
    if (!found.length) console.log('No webcam found.');
    for (const camera of found) console.log(`"${camera}": ${sizesOf(ffmpeg, camera).join(', ')}`);
    return;
  }
  const camera = option(argv, 'camera') ?? found[0];
  if (!camera) {
    console.error('No webcam found: is one plugged in, and not turned off in Windows settings?');
    process.exit(1);
  }
  const size = option(argv, 'size') ?? '640x360';
  const fps = option(argv, 'fps') ?? '10';
  const stream = option(argv, 'stream') ?? 'cam2_sub';
  const port = Number(option(argv, 'port') ?? 8555);
  if (!sizesOf(ffmpeg, camera).some(s => s.startsWith(`${size} `))) {
    console.error(
      `"${camera}" does not film at ${size}. It offers: ${sizesOf(ffmpeg, camera).join(', ')}`
    );
    process.exit(1);
  }

  const args = [
    '-hide_banner',
    '-loglevel',
    'error', // what goes wrong (HARMLESS lines are not shown)
    // the webcam at its own speed for this size (asking for another fps fails: "I/O error")
    ...['-f', 'dshow', '-video_size', size, '-i', `video=${camera}`],
    // H.264 as an IP camera sends it, light and with no delay; a key frame every second, so the
    // relay has a picture soon after it asks
    ...['-r', fps, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency'],
    ...['-pix_fmt', 'yuv420p', '-g', fps],
    ...['-f', 'mpegts', 'pipe:1']
  ];

  // An earlier run's ffmpeg keeps the webcam: this one could not open it.
  if (!hidden && stopEarlier()) console.log('Stopped what an earlier run left holding the webcam.');
  if (hidden) writeFileSync(PID_FILE, String(process.pid));
  const say = (text: string) =>
    console.log(`${hidden ? `${new Date().toISOString()} ` : ''}${text}`);

  /** Who is watching (the relay, once per stream it reads): the webcam is on while there is one. */
  const watchers = new Set<ServerResponse>();
  let webcam: ChildProcess | null = null;

  const webcamOff = (why: string) => {
    if (!webcam) return;
    const running = webcam;
    webcam = null;
    running.kill();
    say(`Webcam off: ${why}.`);
  };

  const webcamOn = () => {
    if (webcam) return;
    say(`Webcam on: the relay asked for ${stream} ("${camera}" ${size} at ${fps} fps).`);
    let lastError = '';
    const started = Date.now();
    const running = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    webcam = running;
    running.stdout!.on('data', (chunk: Buffer) => {
      for (const watcher of watchers) watcher.write(chunk);
    });
    // Whole lines only: a chunk may end mid-line ("[mjpeg @ …]" here, "unable to decode…" next).
    createInterface({ input: running.stderr! }).on('line', (raw: string) => {
      const line = raw.trim();
      if (line && !HARMLESS.test(line)) say(`  ffmpeg: ${(lastError = line)}`);
    });
    running.on('exit', code => {
      if (webcam !== running) return; // turned off on purpose
      webcam = null;
      const why = lastError || `ffmpeg ended (${code})`;
      const hint =
        Date.now() - started < 4000
          ? 'Is the webcam used by another app (Teams, Zoom, Camera, a browser tab)?'
          : 'The webcam stopped.';
      say(`Webcam stopped: ${why}. ${hint} The relay asks again in a moment.`);
      // The relay sees its stream end and asks again: the webcam is tried again then.
      for (const watcher of watchers) watcher.end();
      watchers.clear();
    });
  };

  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== `/${stream}`) {
      res.writeHead(404).end(`Only /${stream} here.`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
    watchers.add(res);
    webcamOn();
    res.on('close', () => {
      watchers.delete(res);
      if (!watchers.size) webcamOff('nothing is watching');
    });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${port} is taken: is another yarn pc-camera running? (yarn pc-camera --stop)`
        : err.message
    );
    process.exit(1);
  });
  // This PC only: the relay in Docker reaches it as host.docker.internal.
  server.listen(port, '127.0.0.1', () =>
    say(
      `Waiting for the relay on http://127.0.0.1:${port}/${stream}${
        hidden ? '' : ' (Ctrl+C to stop)'
      }. Start the camera "PC webcam" in the app: the webcam turns on then, and off when it stops.`
    )
  );

  // However this script ends (Ctrl+C, the window closed, killed), the webcam ends with it: an
  // ffmpeg left behind keeps it, and the next `yarn pc-camera` can't open it.
  const stop = () => {
    webcamOff('stopped');
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const)
    process.on(signal, stop);
  process.on('exit', () => {
    webcam?.kill();
    if (hidden && backgroundPid() === process.pid) unlinkSync(PID_FILE);
  });
}

main();
