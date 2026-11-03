import { encode as encodeJpeg } from 'jpeg-js';

import {
  FrameSource,
  frameOfJpeg,
  grabJpeg,
  inputArgs,
  isPhoneSource,
  missingFileError,
  resolveFfmpeg
} from './frame-source';

// A camera's source: a stream (rtsp / http…) or a video file; a file that is not there is said
// plainly instead of ffmpeg's "Did you mean file:…?" (a Windows path saved on Linux, in Docker).
describe('missingFileError', () => {
  it('nothing to say for a camera stream or a file that is there', () => {
    expect(missingFileError('rtsp://10.0.0.5:554/stream1')).toBeNull();
    expect(missingFileError('http://cam.local/video.mjpg')).toBeNull();
    expect(missingFileError('test-videos/warehouse-zone-by-hand.mp4')).toBeNull();
  });

  it('names a missing file, and a Windows path on another system', () => {
    expect(missingFileError('test-videos/nope.mp4')).toBe(
      'The video file is not there: test-videos/nope.mp4'
    );
    const windows = missingFileError('C:\\Users\\me\\test-videos\\belt.mp4');
    expect(windows).toContain('The video file is not there: C:\\Users\\me\\test-videos\\belt.mp4');
    if (process.platform !== 'win32') expect(windows).toContain('a Windows path');
  });
});

describe('a missing video file', () => {
  it('ends the frame source with that message (no ffmpeg run)', done => {
    const source = new FrameSource({
      url: 'test-videos/nope.mp4',
      fps: 5,
      width: 64,
      height: 36,
      ffmpegPath: 'ffmpeg-not-used'
    });
    source.on('end', ({ error }: { error?: string }) => {
      expect(error).toBe('The video file is not there: test-videos/nope.mp4');
      done();
    });
    source.start();
  });

  it('fails grabbing a snapshot with that message', async () => {
    await expect(
      grabJpeg({
        url: 'test-videos/nope.mp4',
        width: 64,
        height: 36,
        ffmpegPath: 'ffmpeg-not-used'
      })
    ).rejects.toThrow('The video file is not there');
  });
});

describe('inputArgs', () => {
  it('a file loops and plays at its own speed; rtsp goes over TCP with a timeout', () => {
    expect(inputArgs('test-videos/a.mp4', true)).toEqual([
      '-stream_loop',
      '-1',
      '-re',
      '-i',
      'test-videos/a.mp4'
    ]);
    expect(inputArgs('rtsp://cam/1', true).slice(0, 2)).toEqual(['-rtsp_transport', 'tcp']);
  });
});

// A phone camera: no stream, the warehouse app sends JPEGs (any size: scaled to the camera's).
describe('phone camera', () => {
  const jpegOf = (width: number, height: number) => {
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < data.length; i += 4) data.set([240, 120, 20, 255], i);
    return new Uint8Array(encodeJpeg({ data, width, height }, 90).data);
  };

  it('"phone:" is a phone, and not a missing file', () => {
    expect(isPhoneSource('phone:')).toBe(true);
    expect(isPhoneSource(' Phone:belt-1')).toBe(true);
    expect(isPhoneSource('rtsp://cam/1')).toBe(false);
    expect(missingFileError('phone:')).toBeNull();
  });

  it('decodes a JPEG of the camera size as rgb24', () => {
    const frame = frameOfJpeg(jpegOf(64, 48), 64, 48);
    expect([frame.width, frame.height, frame.data.length]).toEqual([64, 48, 64 * 48 * 3]);
    expect(Math.abs(frame.data[0] - 240)).toBeLessThan(12);
  });

  it('scales a JPEG of another size to the camera size', () => {
    const frame = frameOfJpeg(jpegOf(128, 72), 64, 36);
    expect([frame.width, frame.height, frame.data.length]).toEqual([64, 36, 64 * 36 * 3]);
    expect(Math.abs(frame.data[frame.data.length - 2] - 120)).toBeLessThan(12);
  });
});

// Which ffmpeg: ffmpeg-static's Linux build crashes on a host name (rtsp://go2rtc:8554/cam1), so a
// system ffmpeg (the Docker image's) comes before it.
describe('resolveFfmpeg', () => {
  it('FFMPEG_PATH when set', () => {
    expect(resolveFfmpeg('/opt/ffmpeg/bin/ffmpeg', __filename)).toBe('/opt/ffmpeg/bin/ffmpeg');
  });

  it("the system's ffmpeg when there is one", () => {
    // any file that exists stands for /usr/bin/ffmpeg
    expect(resolveFfmpeg('', __filename)).toBe(__filename);
  });

  it("ffmpeg-static's without a system one", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(resolveFfmpeg(undefined, '/nowhere/ffmpeg')).toBe(require('ffmpeg-static'));
  });
});
