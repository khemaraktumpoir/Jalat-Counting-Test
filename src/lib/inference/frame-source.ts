import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { decode as decodeJpeg } from 'jpeg-js';

import type { Frame } from '@lib/counting';

export interface FrameSourceOptions {
  url: string;
  fps: number;
  width: number;
  height: number;
  /** A video file: play it again at its end. */
  loop?: boolean;
  /** A video file: at its own speed like a camera (default), or as fast as possible (tests). */
  realtime?: boolean;
  ffmpegPath: string;
}

/** The system's ffmpeg on Linux (the Docker image installs Debian's). */
export const SYSTEM_FFMPEG = '/usr/bin/ffmpeg';

/**
 * ffmpeg: FFMPEG_PATH when set; else the system's (SYSTEM_FFMPEG) when there is one; else the one
 * ffmpeg-static downloads (a Windows or macOS PC). The system's comes first because ffmpeg-static's
 * Linux build is fully static and crashes (segfault) looking up a host name: a camera at
 * rtsp://go2rtc:8554/cam1 or https://cloud…/live.m3u8 never opened, only IP addresses did.
 */
export function resolveFfmpeg(configured?: string, systemPath = SYSTEM_FFMPEG): string {
  if (configured) return configured;
  if (existsSync(systemPath)) return systemPath;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bundled = require('ffmpeg-static') as string | null;
  if (!bundled || !existsSync(bundled))
    throw new Error(
      'No ffmpeg: install one (apt install ffmpeg), or ffmpeg-static, or set FFMPEG_PATH.'
    );
  return bundled;
}

/** A network camera (rtsp://, http://…), not a video file. */
export const isStream = (url: string) => /^(rtsp|rtmp|http|https|udp|tcp):\/\//i.test(url);

/**
 * A phone's IP-camera app on the Wi-Fi (IP Webcam http://<ip>:8080/video, DroidCam :4747/video), as
 * the warehouse app sets it up: a stream, but a phone, not a network camera.
 */
export const isPhoneAppSource = (url: string) =>
  /^http:\/\/(\d{1,3}\.){3}\d{1,3}:(8080|4747)\/video$/i.test(url.trim());

/** A network (IP) camera: a stream address that is not a phone app. A warehouse has one. */
export const isNetworkCamera = (url: string) => isStream(url.trim()) && !isPhoneAppSource(url);

/**
 * A phone camera ("phone:"): no stream to open — the warehouse app sends the phone's camera frames
 * (POST /api/v1/counting/cameras/:id/frames) while its page is open, straight into the worker.
 */
export const PHONE_SOURCE = 'phone:';
export const isPhoneSource = (url: string) => url.trim().toLowerCase().startsWith(PHONE_SOURCE);

/**
 * A manual counter ("manual:"): no camera at all — warehouse staff count parcels by scanning
 * their QR stickers (each once since the last reset) or tapping +1, with addManualCount. It has
 * the cameras' list, live counts, history and reset.
 */
export const MANUAL_SOURCE = 'manual:';
export const isManualSource = (url: string) => url.trim().toLowerCase().startsWith(MANUAL_SOURCE);

/**
 * A video file that is not there, said plainly (ffmpeg's own message for "C:\…" on Linux is "Did you
 * mean file:C:\…?"). A relative path is from the service's folder (test-videos/…); null when it is there
 * or the source is a camera.
 */
export function missingFileError(url: string): string | null {
  if (isStream(url) || isPhoneSource(url) || isManualSource(url) || existsSync(url)) return null;
  const foreign = process.platform !== 'win32' && /^[a-z]:[\\/]/i.test(url);
  return `The video file is not there: ${url}${
    foreign
      ? ' (a Windows path: use a path on this machine, or one from the service folder, e.g. test-videos/…)'
      : ''
  }`;
}

/** A phone's JPEG as an rgb24 frame of the camera's size (scaled, nearest pixel, when it differs). */
export function frameOfJpeg(jpeg: Uint8Array, width: number, height: number): Frame {
  const image = decodeJpeg(jpeg, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 20 });
  const rgb = image.data as Uint8Array;
  if (image.width === width && image.height === height) return { data: rgb, width, height };
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sy * image.width + sx) * 3;
      const to = (y * width + x) * 3;
      data[to] = rgb[from];
      data[to + 1] = rgb[from + 1];
      data[to + 2] = rgb[from + 2];
    }
  }
  return { data, width, height };
}

// A camera that does not answer fails after this long instead of waiting for ever (microseconds).
const IO_TIMEOUT_US = '10000000';

/** ffmpeg's input arguments for a camera or a file. */
export function inputArgs(url: string, loop: boolean, realtime = true): string[] {
  if (/^rtsp:\/\//i.test(url))
    return ['-rtsp_transport', 'tcp', '-timeout', IO_TIMEOUT_US, '-i', url];
  if (isStream(url)) return ['-rw_timeout', IO_TIMEOUT_US, '-i', url];
  // A file plays at its own speed (-re), like a camera would, in a loop when asked.
  return [...(loop ? ['-stream_loop', '-1'] : []), ...(realtime ? ['-re'] : []), '-i', url];
}

/**
 * Reads a camera or a video file with ffmpeg as raw rgb24 frames of width × height at `fps`
 * (scaled by ffmpeg, so every frame has the region's size). Events: 'frame' (Frame), 'end' (the
 * stream stopped: ffmpeg exited; `error` text when it failed).
 */
export class FrameSource extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private stderrTail = '';

  constructor(private readonly options: FrameSourceOptions) {
    super();
  }

  get frameBytes(): number {
    return this.options.width * this.options.height * 3;
  }

  start(): void {
    const { url, fps, width, height, loop = false, realtime = true, ffmpegPath } = this.options;
    const missing = missingFileError(url);
    if (missing) {
      // As ffmpeg's own failure: after start() returns, so listeners are in place.
      setImmediate(() => this.emit('end', { error: missing }));
      return;
    }
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      ...inputArgs(url, loop, realtime),
      '-an',
      '-vf', `fps=${fps},scale=${width}:${height}`,
      '-pix_fmt', 'rgb24',
      '-f', 'rawvideo',
      'pipe:1'
    ]; // prettier-ignore
    this.buffer = Buffer.alloc(0);
    this.stderrTail = '';
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    this.process = child;
    child.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    child.stderr.on(
      'data',
      (chunk: Buffer) => (this.stderrTail = (this.stderrTail + chunk.toString()).slice(-800))
    );
    child.on('error', error => this.emit('end', { error: error.message }));
    child.on('close', code => {
      if (this.process !== child) return;
      this.process = null;
      this.emit('end', {
        error: code === 0 ? undefined : this.stderrTail.trim() || `ffmpeg exited with ${code}`
      });
    });
  }

  /** Cuts ffmpeg's stdout into whole frames (a chunk may hold part of one, or several). */
  private onData(chunk: Buffer): void {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const size = this.frameBytes;
    while (this.buffer.length >= size) {
      const data = new Uint8Array(this.buffer.subarray(0, size));
      this.buffer = this.buffer.subarray(size);
      const frame: Frame = { data, width: this.options.width, height: this.options.height };
      this.emit('frame', frame);
    }
  }

  stop(): void {
    const child = this.process;
    this.process = null;
    if (child && !child.killed) child.kill('SIGKILL');
  }
}

/** One JPEG frame from a camera or file (the region editor's background when the camera is not running). */
export function grabJpeg(
  options: Omit<FrameSourceOptions, 'fps' | 'loop'>,
  timeoutMs = 15_000
): Promise<Buffer> {
  const { url, width, height, ffmpegPath } = options;
  const missing = missingFileError(url);
  if (missing) return Promise.reject(new Error(missing));
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    ...inputArgs(url, false, false),
    '-frames:v', '1',
    '-vf', `scale=${width}:${height}`,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    'pipe:1'
  ]; // prettier-ignore
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('The camera did not send a frame in time.'));
    }, timeoutMs);
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('error', e => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      const jpeg = Buffer.concat(chunks);
      if (code === 0 && jpeg.length) resolve(jpeg);
      else reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`));
    });
  });
}
