import { resolve } from 'path';

export const TIME_ZONE = 'Asia/Phnom_Penh';
export const ASSETS_PATH = resolve('.', 'assets',); // prettier-ignore
export const TEMP_PATH   = resolve('.', 'public', 'upload', 'temp'); // prettier-ignore

// Who may use the counting API: the warehouse app's accounts, and admins.
export const COUNTING_ROLES = ['ADMIN', 'OPERATION', 'MOBILE_WAREHOUSE'];

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
