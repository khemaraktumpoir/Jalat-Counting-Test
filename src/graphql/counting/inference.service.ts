import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '@lib/config';
import { DEMO_LABELS, DEMO_MODEL, isUltralyticsModel, ultralyticsUrlOf } from '@lib/counting';
import { loadLabels, loadOnnxModel, resolveFfmpeg } from '@lib/inference';

/**
 * The model and its labels, checked once at startup: the API loads the model to report its input
 * and output (and fail early on a bad file); each camera worker loads its own copy to run it.
 * A missing model does not stop the service: the API, the cameras and their regions still work,
 * and cameras say why they cannot count.
 */
@Injectable()
export class InferenceService implements OnModuleInit {
  private readonly logger = new Logger('InferenceService');
  labels: Record<number, string> = {};
  modelLoaded = false;
  modelError: string | null = null;
  inputName = '';
  outputName = '';

  constructor(private readonly config: ConfigService) {}

  get modelPath(): string {
    return this.config.env.MODEL_PATH;
  }

  get provider(): string {
    if (this.modelPath === DEMO_MODEL) return 'demo';
    if (isUltralyticsModel(this.modelPath)) return 'ultralytics';
    return this.config.env.MODEL_PROVIDER || 'cpu';
  }

  /** CPU threads per camera's model (MODEL_THREADS); 0 = all cores. */
  get threads(): number {
    return Number(this.config.env.MODEL_THREADS) || 0;
  }

  /** The Platform endpoint for cameras set to run on it: ULTRALYTICS_ENDPOINT_URL, else MODEL_PATH's when that is one. */
  get platformUrl(): string | undefined {
    const url = this.config.env.ULTRALYTICS_ENDPOINT_URL?.trim();
    if (url) return url;
    return isUltralyticsModel(this.modelPath)
      ? ultralyticsUrlOf(this.modelPath) || undefined
      : undefined;
  }

  /** Cameras can be set to run on Ultralytics Platform (an endpoint and a key). */
  get platformAvailable(): boolean {
    return !!this.platformUrl && !!this.apiKey?.trim();
  }

  /** MODEL_PATH=ultralytics:<url>: the key the camera workers send. */
  get apiKey(): string | undefined {
    return this.config.env.ULTRALYTICS_API_KEY;
  }

  get ffmpegPath(): string {
    return resolveFfmpeg(this.config.env.FFMPEG_PATH);
  }

  async onModuleInit(): Promise<void> {
    if (this.modelPath === DEMO_MODEL) {
      // Demo: orange boxes found by colour, no model (ColorDetector). Not for real counting.
      this.labels = DEMO_LABELS;
      this.modelLoaded = true;
      this.logger.warn('MODEL_PATH=demo:orange: counting orange boxes by colour (demo, no model).');
      return;
    }
    try {
      this.labels = loadLabels(this.config.env.MODEL_CLASSES_PATH);
    } catch (error: any) {
      this.logger.error(
        `Labels not loaded (${this.config.env.MODEL_CLASSES_PATH}): ${error.message}`
      );
    }
    if (isUltralyticsModel(this.modelPath)) {
      // The model runs on Ultralytics Platform: nothing to load here; the labels still come from
      // MODEL_CLASSES_PATH (the model's class names, in order).
      const url = ultralyticsUrlOf(this.modelPath);
      if (!url || !this.apiKey) {
        this.modelError = !url
          ? 'MODEL_PATH=ultralytics:<endpoint url>: the url is missing.'
          : 'ULTRALYTICS_API_KEY is not set.';
        this.logger.error(`Model not loaded: ${this.modelError}`);
        return;
      }
      this.modelLoaded = true;
      this.logger.log(`Model on Ultralytics Platform: ${new URL(url).host} (one request a frame).`);
      return;
    }
    try {
      const model = await loadOnnxModel(this.modelPath, this.provider, this.threads);
      this.modelLoaded = true;
      this.inputName = model.inputName;
      this.outputName = model.outputName;
      this.logger.log(
        `Model ${this.modelPath} loaded on ${this.provider} (input ${model.inputName}, output ${model.outputName}).`
      );
    } catch (error: any) {
      this.modelError = error.message;
      this.logger.error(`Model not loaded: ${error.message}`);
    }
  }
}
