/**
 * One camera, in its own worker thread (CameraManagerService starts it), so inference never blocks
 * the API: ffmpeg frames → YOLO26 → tracker → counter. Frames that arrive while the model is busy
 * are dropped (the newest one is taken next), so a slow CPU lowers the effective fps instead of
 * falling behind. A stream that stops is opened again after 2 s, 4 s, 8 s … (at most reconnectMaxMs);
 * a video file that ends without `loop` is not: the camera stops there ('ended').
 * A phone camera ("phone:") has no stream: the warehouse app's JPEGs come as 'frame' messages.
 * The ONNX model runs in the model pool's worker shared with the other cameras (RemoteModel; data.pooled),
 * else here (MODEL_WORKERS=0, demo:orange, ultralytics:).
 * The live preview (only while someone watches) is sent at most PREVIEW_FPS a second and at most
 * PREVIEW_WIDTH wide: a full-size JPEG of every frame cost the CPU and the viewer's mobile data.
 */
import { encode as encodeJpeg } from 'jpeg-js';
import { parentPort, workerData } from 'worker_threads';

import { C } from '@common';
import {
  ColorDetector,
  COLORS,
  CountingPipeline,
  Counts,
  DEMO_MODEL,
  isParcelModel,
  isUltralyticsModel,
  UltralyticsApiDetector,
  ultralyticsUrlOf,
  Detector,
  DetectorLike,
  drawInArrow,
  drawPolyline,
  Frame,
  RegionShape,
  shrinkFrame,
  Track
} from '@lib/counting';
import {
  FrameSource,
  foldClasses,
  frameOfJpeg,
  isPhoneSource,
  isStream,
  loadOnnxModel,
  relayEmptyHint
} from '@lib/inference';

import type { CameraWorkerData, FromWorker, RunStatus, ToWorker } from './camera-worker.protocol';
import { RemoteModel } from './remote-model';

const data = workerData as CameraWorkerData;
/** The live preview: at most this many pictures a second, at most this wide (the counting runs at full size). */
const PREVIEW_FPS = 5;
const PREVIEW_WIDTH = 640;
const post = (message: FromWorker) => parentPort!.postMessage(message);

let pipeline: CountingPipeline | null = null;
let detector: DetectorLike | null = null;
let conf = data.conf;
let classes = data.classes;
let source: FrameSource | null = null;
let lastFrame: Frame | null = null;
let lastTracks: Track[] = [];
let busy = false;
let pending: Frame | null = null;
let preview = false;
let lastPreviewAt = 0;
let stopped = false;
let lastCountsJson = '';
let retryMs = 2000;
let retryTimer: NodeJS.Timeout | null = null;
let status: RunStatus = 'STARTING';
let processed = 0;
let fpsWindowStart = Date.now();
let fps = 0;
/** Why frames are read but not counted (no model, no region yet); null while counting. */
let notCounting: string | null = null;
let region: RegionShape | null = data.region;
/** Pooled: the model worker's side, its port sent by the manager. */
const remote = data.pooled ? new RemoteModel() : null;

function setStatus(next: RunStatus, error?: string): void {
  status = next;
  post({
    type: 'status',
    status,
    fps,
    error: error ?? (next === 'RUNNING' ? notCounting ?? undefined : undefined)
  });
}

function jpegOf(frame: Frame, quality = 70): Uint8Array {
  // jpeg-js wants RGBA.
  const rgba = new Uint8Array(frame.width * frame.height * 4);
  for (let i = 0, j = 0; i < frame.data.length; i += 3, j += 4) {
    rgba[j] = frame.data[i];
    rgba[j + 1] = frame.data[i + 1];
    rgba[j + 2] = frame.data[i + 2];
    rgba[j + 3] = 255;
  }
  return encodeJpeg({ data: rgba, width: frame.width, height: frame.height }, quality).data;
}

function postCounts(counts: Counts): void {
  const json = JSON.stringify(counts);
  if (json === lastCountsJson) return;
  lastCountsJson = json;
  post({ type: 'count', counts });
}

async function processFrame(frame: Frame): Promise<void> {
  busy = true;
  try {
    lastFrame = frame;
    if (pipeline) {
      const result = await pipeline.process(frame);
      lastTracks = result.tracks;
      postCounts({ in: result.in, out: result.out, byClass: result.byClass });
      // Counting again after a failed frame (the model worker restarted).
      if (status === 'ERROR') setStatus('RUNNING');
    }
    const now = Date.now();
    if (preview && now - lastPreviewAt >= 1000 / PREVIEW_FPS) {
      lastPreviewAt = now;
      const copy: Frame = { ...frame, data: new Uint8Array(frame.data) };
      if (pipeline) pipeline.annotate(copy, lastTracks);
      else if (region) {
        drawPolyline(copy, region.points, COLORS.region, region.type === 'POLYGON');
        if (region.type === 'LINE')
          drawInArrow(copy, region.points[0], region.points[1], COLORS.inArrow);
      }
      post({ type: 'preview', jpeg: jpegOf(shrinkFrame(copy, PREVIEW_WIDTH), 70) });
    }
    processed += 1;
    if (now - fpsWindowStart >= 5000) {
      fps = Math.round((processed * 10_000) / (now - fpsWindowStart)) / 10;
      processed = 0;
      fpsWindowStart = now;
      post({
        type: 'status',
        status,
        fps,
        error: status === 'RUNNING' ? notCounting ?? undefined : undefined
      });
    }
  } catch (error: any) {
    setStatus('ERROR', error?.message ?? String(error));
  } finally {
    busy = false;
    if (pending && !stopped) {
      const next = pending;
      pending = null;
      void processFrame(next);
    }
  }
}

function startPipeline(next: RegionShape): void {
  region = next;
  if (!detector) return;
  // The parcel model: its boxes tidied on every frame, as photos are (one track per parcel).
  const tidy = !!data.modelPath && data.modelPath !== DEMO_MODEL && isParcelModel(data.labels);
  pipeline = new CountingPipeline(detector, {
    conf,
    classes,
    labels: data.labels,
    region: next,
    tidy
  });
  notCounting = null;
  if (status === 'RUNNING') setStatus('RUNNING');
}

function openStream(): void {
  if (stopped) return;
  source = new FrameSource({
    url: data.sourceUrl,
    fps: data.fps,
    width: data.width,
    height: data.height,
    loop: data.loop,
    ffmpegPath: data.ffmpegPath
  });
  let gotFrame = false;
  source.on('frame', (frame: Frame) => {
    if (!gotFrame) {
      gotFrame = true;
      retryMs = 2000;
      setStatus('RUNNING');
    }
    if (busy) pending = frame;
    else void processFrame(frame);
  });
  source.on('end', ({ error }: { error?: string }) => {
    source = null;
    if (stopped) return;
    // A video file played to its end with "Play the video again" off: done, not a lost camera.
    if (!error && !data.loop && !isStream(data.sourceUrl)) return void finishVideo();
    // ffmpeg's last line says why ("Connection refused", "404 Not Found", "Error number -138"…).
    const why = error?.split('\n').pop()?.trim();
    const relayEmpty = why ? relayEmptyHint(data.sourceUrl, why) : null;
    setStatus(
      'RECONNECTING',
      relayEmpty ?? (why ? `Can't reach the camera: ${why}` : 'The stream ended.')
    );
    retryTimer = setTimeout(openStream, retryMs);
    // An empty relay stream is filled any moment (yarn pc-camera started): looked at every 5 s.
    retryMs = Math.min(retryMs * 2, relayEmpty ? 5000 : data.reconnectMaxMs);
  });
  source.start();
}

/** Counts the frames still in hand, then tells the manager the video is over (it stops the camera). */
function finishVideo(): void {
  if (busy || pending) {
    setTimeout(finishVideo, 50);
    return;
  }
  post({ type: 'ended' });
}

// ---- A phone camera: frames while the app's page is open, "waiting" when they stop ----
const PHONE_WAIT =
  'Waiting for the phone or PC: open this camera in the warehouse app on the device that films the belt and start filming.';
const PHONE_SILENT_MS = 10_000;
let phoneTimer: NodeJS.Timeout | null = null;

function waitForPhone(): void {
  setStatus('RECONNECTING', PHONE_WAIT);
}

function onPhoneFrame(jpeg: Uint8Array): void {
  if (stopped) return;
  let frame: Frame;
  try {
    frame = frameOfJpeg(jpeg, data.width, data.height);
  } catch (error: any) {
    setStatus(
      'RECONNECTING',
      `The phone sent a picture that can't be read: ${error?.message ?? error}`
    );
    return;
  }
  if (status !== 'RUNNING') setStatus('RUNNING');
  if (phoneTimer) clearTimeout(phoneTimer);
  phoneTimer = setTimeout(waitForPhone, PHONE_SILENT_MS);
  if (busy) pending = frame;
  else void processFrame(frame);
}

parentPort!.on('message', (message: ToWorker) => {
  switch (message.type) {
    case 'update':
      if (message.conf !== undefined) conf = message.conf;
      if (message.classes !== undefined) classes = message.classes;
      // A camera started before its region was drawn starts counting with the first one.
      if (!pipeline) {
        if (message.region) startPipeline(message.region);
        break;
      }
      if (message.region) region = message.region;
      pipeline.update({
        ...(message.conf !== undefined ? { conf: message.conf } : {}),
        ...(message.classes !== undefined ? { classes: message.classes } : {}),
        ...(message.region ? { region: message.region } : {})
      });
      break;
    case 'reset':
      pipeline?.reset();
      lastCountsJson = '';
      postCounts({ in: 0, out: 0, byClass: {} });
      break;
    case 'snapshot':
      post({
        type: 'snapshot',
        requestId: message.requestId,
        jpeg: lastFrame ? jpegOf(lastFrame, 85) : null,
        error: lastFrame ? undefined : 'No frame yet.'
      });
      break;
    case 'preview':
      preview = message.on;
      break;
    case 'frame':
      if (isPhoneSource(data.sourceUrl)) onPhoneFrame(message.jpeg);
      break;
    case 'model':
      remote?.use(message.port);
      break;
    case 'stop':
      stopped = true;
      remote?.close();
      if (retryTimer) clearTimeout(retryTimer);
      if (phoneTimer) clearTimeout(phoneTimer);
      source?.stop();
      process.exit(0);
  }
});

(async () => {
  setStatus('STARTING');
  try {
    if (data.modelPath === DEMO_MODEL) detector = new ColorDetector();
    else if (isUltralyticsModel(data.modelPath)) {
      // The model on Ultralytics Platform: one JPEG a frame over HTTPS, no model on this server.
      detector = new UltralyticsApiDetector({
        url: ultralyticsUrlOf(data.modelPath),
        apiKey: data.apiKey ?? '',
        imgsz: C.MODEL_INPUT_SIZE
      });
    } else if (remote) {
      // One copy of the model for every camera on it: the model pool's worker.
      await remote.ready;
      detector = new Detector(remote.infer, C.MODEL_INPUT_SIZE, foldClasses(data.labels));
    } else {
      const model = await loadOnnxModel(data.modelPath, data.provider, data.threads);
      // The parcel model's words for one thing (all labelled "parcel") count as one class.
      detector = new Detector(model.infer, C.MODEL_INPUT_SIZE, foldClasses(data.labels));
    }
    if (data.region) startPipeline(data.region);
    else notCounting = 'Not counting: draw a counting line or area first.';
  } catch (error: any) {
    // No model: still read the camera (snapshot, preview, region editor), but say why nothing counts.
    notCounting = `Not counting: ${error?.message ?? error}`;
  }
  if (isPhoneSource(data.sourceUrl)) waitForPhone();
  else openStream();
})();
