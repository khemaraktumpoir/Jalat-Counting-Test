import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';

import { listTestVideos, testVideoFile, testVideoPreset, testVideoPresets } from './test-videos';

describe('listTestVideos', () => {
  let dir: string;
  let root: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'test-videos-'));
    root = relative(process.cwd(), dir);
    mkdirSync(join(dir, 'real-2026-10-27', 'deeper', 'too-deep'), { recursive: true });
    writeFileSync(join(dir, 'conveyor-synthetic.mp4'), '');
    writeFileSync(join(dir, 'real-2026-10-27', 'video_2.MOV'), '');
    writeFileSync(join(dir, 'real-2026-10-27', 'video_1.mp4'), '');
    writeFileSync(join(dir, 'real-2026-10-27', 'README.md'), '');
    writeFileSync(join(dir, 'real-2026-10-27', 'deeper', 'too-deep', 'x.mp4'), '');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('lists the videos, in subfolders too, as the paths a camera source takes', () => {
    const r = root.replace(/\\/g, '/');
    expect(listTestVideos(root)).toEqual([
      `${r}/conveyor-synthetic.mp4`,
      `${r}/real-2026-10-27/video_1.mp4`,
      `${r}/real-2026-10-27/video_2.MOV`
    ]);
  });

  it('is empty without a test-videos folder', () => {
    expect(listTestVideos(join(root, 'missing'))).toEqual([]);
  });
});

describe('testVideoFile', () => {
  let dir: string;
  let root: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'test-videos-'));
    root = relative(process.cwd(), dir).replace(/\\/g, '/');
    writeFileSync(join(dir, 'zone.mp4'), '');
    writeFileSync(join(dir, 'zone-counted.mp4'), '');
    writeFileSync(join(dir, 'belt.mp4'), '');
    writeFileSync(join(dir, 'notes.txt'), '');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds a camera's video and its counted copy in the folder", () => {
    expect(testVideoFile(`${root}/zone.mp4`, false, root)).toBe(join(dir, 'zone.mp4'));
    expect(testVideoFile(`${root}/zone.mp4`, true, root)).toBe(join(dir, 'zone-counted.mp4'));
  });

  it('nothing for a video not there, no counted copy, or not a video', () => {
    expect(testVideoFile(`${root}/nope.mp4`, false, root)).toBeNull();
    expect(testVideoFile(`${root}/belt.mp4`, true, root)).toBeNull();
    expect(testVideoFile(`${root}/notes.txt`, false, root)).toBeNull();
    expect(testVideoFile('rtsp://10.0.0.5:554/stream1', false, root)).toBeNull();
    expect(testVideoFile('phone:', false, root)).toBeNull();
  });

  it('nothing outside the folder', () => {
    expect(testVideoFile(`${root}/../zone.mp4`, false, root)).toBeNull();
    expect(testVideoFile(join(tmpdir(), 'elsewhere.mp4'), false, root)).toBeNull();
  });
});

describe('test-video presets (cameras.json) and counted copies', () => {
  let dir: string;
  let root: string;
  const preset = (sourceUrl: string, name: string) => ({
    name,
    sourceUrl,
    about: 'a test',
    fps: 10,
    confThreshold: 0.4,
    width: 1280,
    height: 720,
    loop: true,
    model: 'demo:orange',
    region: {
      type: 'POLYGON',
      points: [
        { x: 1, y: 1 },
        { x: 9, y: 1 },
        { x: 9, y: 9 }
      ]
    },
    expected: { in: 9, out: 0 }
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'test-videos-'));
    root = relative(process.cwd(), dir).replace(/\\/g, '/');
    writeFileSync(join(dir, 'zone.mp4'), '');
    writeFileSync(join(dir, 'zone-counted.mp4'), '');
    writeFileSync(
      join(dir, 'cameras.json'),
      JSON.stringify([preset(`${root}/zone.mp4`, 'Zone'), preset(`${root}/gone.mp4`, 'Gone')])
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('does not offer a counted copy as a camera source', () => {
    expect(listTestVideos(root)).toEqual([`${root}/zone.mp4`]);
  });

  it('reads the presets whose video is there', () => {
    expect(testVideoPresets(`${root}/cameras.json`).map(p => p.name)).toEqual(['Zone']);
  });

  it("finds a video's preset by its source, also written with backslashes", () => {
    const file = `${root}/cameras.json`;
    expect(testVideoPreset(`${root}/zone.mp4`, file)?.model).toBe('demo:orange');
    expect(testVideoPreset(`${root}/zone.mp4`.replace(/\//g, '\\'), file)?.name).toBe('Zone');
    expect(testVideoPreset(`${root}/gone.mp4`, file)).toBeNull();
  });

  it('no presets without a cameras.json', () => {
    expect(testVideoPresets(`${root}/missing.json`)).toEqual([]);
  });
});
