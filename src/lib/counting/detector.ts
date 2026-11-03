import { letterbox, Letterbox, toSourceBox } from './preprocess';
import { Detection, Frame } from './types';

/** The model's raw output: YOLO26 (NMS-free) gives [1, N, 6] = x1, y1, x2, y2, score, class. */
export interface ModelOutput {
  data: Float32Array;
  dims: readonly number[];
}

/** Runs the model on a 1×3×size×size tensor (the ONNX session, or a fake in tests). */
export type InferFn = (input: Float32Array, size: number) => Promise<ModelOutput>;

export interface DetectOptions {
  /** Minimum score (0–1). */
  conf: number;
  /** Class ids to keep; empty = all. */
  classes?: number[];
  /** Classes counted as another (labels/foldClasses: the parcel model's words for one thing), before `classes`. */
  fold?: Record<number, number>;
}

/**
 * Reads [1, N, 6] (x1, y1, x2, y2, score, class in model pixels) into detections in source
 * pixels: low scores and other classes dropped, empty boxes dropped.
 */
export function parseDetections(
  output: ModelOutput,
  lb: Pick<Letterbox, 'scale' | 'padX' | 'padY'>,
  width: number,
  height: number,
  options: DetectOptions
): Detection[] {
  const { data, dims } = output;
  const stride = dims[dims.length - 1];
  if (dims.length !== 3 || stride < 6) {
    throw new Error(
      `Unexpected model output [${dims.join(', ')}]: expected [1, N, 6] (YOLO26, NMS-free).`
    );
  }
  const rows = dims[1];
  const keep = options.classes?.length ? new Set(options.classes) : null;
  const detections: Detection[] = [];
  for (let i = 0; i < rows; i += 1) {
    const o = i * stride;
    const score = data[o + 4];
    if (!(score >= options.conf)) continue;
    const raw = Math.round(data[o + 5]);
    const classId = options.fold?.[raw] ?? raw;
    if (keep && !keep.has(classId)) continue;
    const box = toSourceBox(
      { x1: data[o], y1: data[o + 1], x2: data[o + 2], y2: data[o + 3] },
      lb,
      width,
      height
    );
    if (box.x2 - box.x1 < 1 || box.y2 - box.y1 < 1) continue;
    detections.push({ box, score, classId });
  }
  return detections;
}

/** Frame in, detections out (source pixels). */
export class Detector {
  constructor(
    private readonly infer: InferFn,
    private readonly size: number,
    /** The model's classes that count as one (labels/foldClasses); none = as they are. */
    private readonly fold: Record<number, number> = {}
  ) {}

  async detect(frame: Frame, options: DetectOptions): Promise<Detection[]> {
    const lb = letterbox(frame, this.size);
    const output = await this.infer(lb.tensor, this.size);
    return parseDetections(output, lb, frame.width, frame.height, { fold: this.fold, ...options });
  }
}
