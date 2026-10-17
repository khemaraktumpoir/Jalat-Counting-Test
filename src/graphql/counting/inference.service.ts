import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ConfigService } from '@lib/config';
import { DEMO_LABELS, DEMO_MODEL } from '@lib/counting';
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
    return this.config.env.MODEL_PROVIDER || 'cpu';
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
    try {
      const model = await loadOnnxModel(this.modelPath, this.provider);
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
