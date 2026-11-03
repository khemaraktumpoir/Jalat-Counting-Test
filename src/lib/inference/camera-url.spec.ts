import { expandEnv, networkCameraUrl, relayEmptyHint } from './camera-url';

// The site camera list (test-videos/cameras.json): a network camera's address, as the warehouse
// app's form builds it, with its password from .env.
describe('networkCameraUrl', () => {
  const env = { CAM_ZONE_A_PASSWORD: 'p@ss:word' };

  it('a Hikvision on its own: the small stream, the password from .env, encoded', () => {
    expect(
      networkCameraUrl(
        { brand: 'hikvision', host: '192.168.1.64', password: '${CAM_ZONE_A_PASSWORD}' },
        env
      )
    ).toBe('rtsp://admin:p%40ss%3Aword@192.168.1.64:554/Streaming/Channels/102');
  });

  it('a camera on a recorder: its channel, full size', () => {
    expect(
      networkCameraUrl(
        { brand: 'dahua', host: '192.168.1.108', password: 'x', channel: 3, stream: 'main' },
        env
      )
    ).toBe('rtsp://admin:x@192.168.1.108:554/cam/realmonitor?channel=3&subtype=0');
  });

  it('the go2rtc relay: no login, its port', () => {
    expect(networkCameraUrl({ brand: 'go2rtc', host: 'go2rtc', channel: 2 })).toBe(
      'rtsp://go2rtc:8554/cam2_sub'
    );
  });

  it('refuses an unknown brand, a missing host, or a password not in .env', () => {
    expect(() => networkCameraUrl({ brand: 'acme', host: '10.0.0.1' })).toThrow('Unknown brand');
    expect(() => networkCameraUrl({ brand: 'hikvision', host: ' ' })).toThrow('no host');
    expect(() =>
      networkCameraUrl({ brand: 'hikvision', host: '10.0.0.1', password: '${CAM_B_PASSWORD}' }, env)
    ).toThrow('Set CAM_B_PASSWORD in .env.');
  });
});

describe('expandEnv', () => {
  it('fills ${NAME} and says which are missing (empty is missing)', () => {
    expect(expandEnv('a ${X} b', { X: '1' })).toBe('a 1 b');
    expect(() => expandEnv('${X}${Y}', { X: '' })).toThrow('Set X, Y in .env.');
  });
});

describe('relayEmptyHint', () => {
  it('says to run yarn pc-camera when the webcam stream is empty', () => {
    expect(
      relayEmptyHint(
        'rtsp://go2rtc:8554/cam2_sub',
        'rtsp://go2rtc:8554/cam2_sub: Server returned 404 Not Found'
      )
    ).toMatch(/yarn pc-camera/);
  });

  it('asks about another relay stream, and says nothing for other errors or cameras', () => {
    expect(relayEmptyHint('rtsp://go2rtc:8554/cam5', 'Server returned 404 Not Found')).toMatch(
      /cam5 in the relay's go2rtc.yaml/
    );
    expect(relayEmptyHint('rtsp://go2rtc:8554/cam2_sub', 'Connection refused')).toBeNull();
    expect(
      relayEmptyHint('rtsp://admin:x@192.168.1.64:554/Streaming/Channels/102', '404 Not Found')
    ).toBeNull();
  });
});
