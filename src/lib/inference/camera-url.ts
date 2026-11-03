/**
 * A network camera's RTSP address from what is on its box and in its app (brand, IP, user,
 * password, channel, stream), as the warehouse app's camera form builds it
 * (app.client/warehouse/src/utils/cameraBrands.ts: keep the two in step). For the site camera list,
 * test-videos/cameras.json, which yarn db:seed adds to a warehouse.
 */

export type CameraStream = 'main' | 'sub';

interface Brand {
  user: string;
  port: number;
  path: (channel: number, stream: CameraStream) => string;
}

/** Each maker's documented RTSP path; "channel" is the camera's number on a recorder (NVR), 1 alone. */
export const CAMERA_BRANDS: Record<string, Brand> = {
  hikvision: {
    user: 'admin',
    port: 554,
    path: (ch, s) => `/Streaming/Channels/${ch}0${s === 'main' ? 1 : 2}`
  },
  dahua: {
    user: 'admin',
    port: 554,
    path: (ch, s) => `/cam/realmonitor?channel=${ch}&subtype=${s === 'main' ? 0 : 1}`
  },
  ezviz: { user: 'admin', port: 554, path: (ch, s) => `/h264/ch${ch}/${s}/av_stream` },
  tapo: { user: '', port: 554, path: (_ch, s) => `/stream${s === 'main' ? 1 : 2}` },
  reolink: {
    user: 'admin',
    port: 554,
    path: (ch, s) => `/h264Preview_${String(ch).padStart(2, '0')}_${s}`
  },
  uniview: {
    user: 'admin',
    port: 554,
    path: (ch, s) => `/unicast/c${ch}/s${s === 'main' ? 0 : 1}/live`
  },
  // the go2rtc relay (deploy/go2rtc.yaml): camN full size, camN_sub the small stream; no login
  go2rtc: { user: '', port: 8554, path: (ch, s) => `/cam${ch}${s === 'sub' ? '_sub' : ''}` }
};

/** A network camera as cameras.json describes it. */
export interface NetworkCamera {
  brand: string;
  /** Its IP on the warehouse network (or "go2rtc" for the relay). */
  host: string;
  port?: number;
  /** The brand's usual one when left out (admin). */
  user?: string;
  /** "${CAM_ZONE_A_PASSWORD}": taken from .env, never written in the file. */
  password?: string;
  /** Its number on a recorder (NVR / DVR); 1 for a camera on its own. */
  channel?: number;
  /** "sub" (small: enough to count, lighter) or "main" (full size). */
  stream?: CameraStream;
}

/**
 * ${NAME} in a text replaced by that environment variable. Throws naming the variables not set
 * (empty counts as not set), so a camera is never added with a blank password.
 */
export function expandEnv(text: string, env: Record<string, string | undefined>): string {
  const missing: string[] = [];
  const value = text.replace(/\$\{([A-Z0-9_]+)\}/g, (_all, name: string) => {
    const found = env[name];
    if (!found) missing.push(name);
    return found ?? '';
  });
  if (missing.length) throw new Error(`Set ${missing.join(', ')} in .env.`);
  return value;
}

/** rtsp://user:password@host:port/path, the user and password URL-encoded (@ and : are common). */
export function networkCameraUrl(
  camera: NetworkCamera,
  env: Record<string, string | undefined> = {}
): string {
  const brand = CAMERA_BRANDS[camera.brand];
  if (!brand)
    throw new Error(`Unknown brand "${camera.brand}": ${Object.keys(CAMERA_BRANDS).join(', ')}.`);
  const host = camera.host?.trim();
  if (!host) throw new Error('The camera has no host (its IP).');
  const user = expandEnv(camera.user ?? brand.user, env);
  const password = camera.password ? expandEnv(camera.password, env) : '';
  const login = user
    ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  const channel = Math.max(1, Math.round(camera.channel ?? 1));
  return `rtsp://${login}${host}:${camera.port ?? brand.port}${brand.path(
    channel,
    camera.stream ?? 'sub'
  )}`;
}

/**
 * The relay (go2rtc) answers 404 for a stream with no picture in it: a pushed one (this PC's webcam,
 * `yarn pc-camera`) not being sent, or a stream not in its go2rtc.yaml. Says what to do, else null.
 */
export function relayEmptyHint(sourceUrl: string, why: string): string | null {
  if (!/404/.test(why)) return null;
  const relay = /^rtsp:\/\/(?:[^@/]*@)?(go2rtc|[^/:]+:8554)\/([^/?]+)/i.exec(sourceUrl);
  if (!relay) return null;
  const stream = relay[2];
  return /^cam2(_sub)?$/.test(stream)
    ? `The relay has no picture on ${stream}: on the PC with the webcam, run yarn pc-camera --background (it keeps sending, no window to keep open).`
    : `The relay has no picture on ${stream}: is that camera on, and is ${stream} in the relay's go2rtc.yaml?`;
}
