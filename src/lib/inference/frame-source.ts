import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { EventEmitter } from 'events';

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

/** ffmpeg: the bundled one (ffmpeg-static) unless FFMPEG_PATH says otherwise. */
export function resolveFfmpeg(configured?: string): string {
  if (configured) return configured;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bundled = require('ffmpeg-static') as string | null;
  if (!bundled) throw new Error('No ffmpeg: install ffmpeg-static or set FFMPEG_PATH.');
  return bundled;
}

const isStream = (url: string) => /^(rtsp|rtmp|http|https|udp|tcp):\/\//i.test(url);

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
