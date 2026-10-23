import { resolve } from 'path';

export const TIME_ZONE = 'Asia/Phnom_Penh';
export const ASSETS_PATH = resolve('.', 'assets',); // prettier-ignore
export const TEMP_PATH   = resolve('.', 'public', 'upload', 'temp'); // prettier-ignore

// Who may use the counting API: the warehouse app's accounts, and admins.
export const COUNTING_ROLES = ['ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE'];

// What an account with a role (the User Service's Roles, roleId in the token) may do here: the
// role's permission codes (Permissions / RolePermissions, seeded by scripts/seed-counter-role.ts).
// An account without a role may do all of it, as before roles.
export const COUNTING_PERMISSIONS = {
  /** Cameras, counts, history, live view, photo records. */
  READ: 'COUNTING:READ',
  /** Count photos (upload or folder) and count by hand (QR / tap). */
  COUNT: 'COUNTING:COUNT',
  /** Start, stop and reset a camera; send a phone camera's frames. */
  CONTROL: 'COUNTING:CONTROL',
  /** Add, edit and delete cameras and their counting line / area. */
  SETTING: 'COUNTING:SETTING'
} as const;
export type CountingPermission = (typeof COUNTING_PERMISSIONS)[keyof typeof COUNTING_PERMISSIONS];
export const ALL_COUNTING_PERMISSIONS: CountingPermission[] = Object.values(COUNTING_PERMISSIONS);

// The User Service's cache of a role: user:roles:<roleId> → { isFullAuthorized, permissions }.
export const userRoleKey = (roleId: number) => `user:roles:${roleId}`;

// Live counts and worker status for the apps (the same MQTT broker as the driver locations).
export const mqttCameraCountTopic = (cameraId: string) => `/topic/counting/${cameraId}/count`;
export const mqttCameraStatusTopic = (cameraId: string) => `/topic/counting/${cameraId}/status`;

// The model's input: YOLO26 takes a 640×640 RGB image.
export const MODEL_INPUT_SIZE = 640;

// Camera defaults (a new camera, or one saved without them).
export const DEFAULT_CAMERA_FPS = 10;
export const DEFAULT_CONF_THRESHOLD = 0.4;

// A camera that fails reconnects after 2 s, 4 s, 8 s … at most this long.
export const CAMERA_RECONNECT_MAX_MS = 60_000;
