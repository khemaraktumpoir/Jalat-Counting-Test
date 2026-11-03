import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';

/** The folder of test videos (in Docker: mounted at /usr/src/test-videos), relative to the service. */
export const TEST_VIDEOS_DIR = 'test-videos';
/** What ffmpeg reads as a camera's video file. */
export const VIDEO_FILE = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;
/** x-counted.mp4: x.mp4 with the counting drawn on it, for the app's player, not a camera source. */
const COUNTED_COPY = /-counted\.[a-z0-9]+$/i;

/**
 * The test videos a camera may use as its source (their counted copies, x-counted.mp4, are not) (test-videos/*.mp4, test-videos/<folder>/*.mp4…), as the
 * paths the source field takes ("test-videos/real-2026-10-27/x.mp4"), sorted. Subfolders `depth` deep;
 * none when the folder is missing.
 */
export function listTestVideos(root = TEST_VIDEOS_DIR, depth = 2): string[] {
  const base = resolve(process.cwd(), root);
  const found: string[] = [];
  const walk = (dir: string, level: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // no test-videos folder (a server without one)
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && level < depth) walk(path, level + 1);
      else if (entry.isFile() && VIDEO_FILE.test(entry.name) && !COUNTED_COPY.test(entry.name))
        found.push(join(root, relative(base, path)).replace(/\\/g, '/'));
    }
  };
  walk(base, 0);
  return found.sort();
}

/**
 * The file of a test video a camera plays (its sourceUrl, "test-videos/…"), or its counted copy
 * ("x-counted.mp4", the same video with the region, the boxes and the counts drawn on it), for the
 * app's player: an absolute path inside the test videos' folder, or null (not a test video, outside
 * the folder, not there).
 */
export function testVideoFile(
  sourceUrl: string,
  counted = false,
  root = TEST_VIDEOS_DIR
): string | null {
  if (!VIDEO_FILE.test(sourceUrl)) return null;
  const base = resolve(process.cwd(), root);
  const file = resolve(
    process.cwd(),
    counted ? sourceUrl.replace(/(\.[a-z0-9]+)$/i, '-counted$1') : sourceUrl
  );
  // inside the folder only: not "../x.mp4", nor another drive (an absolute relative path)
  const inside = relative(base, file);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
  return existsSync(file) ? file : null;
}

/** The test cameras' settings: one per test video (test-videos/cameras.json, also read by yarn db:seed). */
export const TEST_CAMERAS_FILE = `${TEST_VIDEOS_DIR}/cameras.json`;

/** One entry of test-videos/cameras.json: how a camera on that test video should be set up. */
export interface TestVideoPreset {
  name: string;
  /** "test-videos/x.mp4", as a camera's source. */
  sourceUrl: string;
  about: string;
  fps: number;
  confThreshold: number;
  width: number;
  height: number;
  loop: boolean;
  /** Its detector instead of the service's MODEL_PATH (demo:orange for the synthetic videos). */
  model?: string | null;
  /** Its counting line or area, in width × height pixels. */
  region: { type: 'LINE' | 'POLYGON'; points: { x: number; y: number }[] };
  /** What one play of the video counts. */
  expected: { in: number; out: number };
}

let presetsCache: { mtimeMs: number; presets: TestVideoPreset[] } | null = null;

/**
 * The test videos' camera settings from test-videos/cameras.json (read again when the file
 * changes); none when it is missing or unreadable (a server without test videos). Only entries
 * whose video is there.
 */
export function testVideoPresets(file = TEST_CAMERAS_FILE): TestVideoPreset[] {
  const path = resolve(process.cwd(), file);
  try {
    const { mtimeMs } = statSync(path);
    if (presetsCache?.mtimeMs !== mtimeMs) {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      presetsCache = { mtimeMs, presets: Array.isArray(parsed) ? parsed : [] };
    }
  } catch {
    return [];
  }
  return presetsCache.presets.filter(
    p => p?.sourceUrl && existsSync(resolve(process.cwd(), p.sourceUrl))
  );
}

/** The preset of one test video (its sourceUrl), if cameras.json has one. */
export function testVideoPreset(
  sourceUrl: string,
  file = TEST_CAMERAS_FILE
): TestVideoPreset | null {
  const wanted = sourceUrl.trim().replace(/\\/g, '/');
  return testVideoPresets(file).find(p => p.sourceUrl === wanted) ?? null;
}
