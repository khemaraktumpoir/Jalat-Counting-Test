import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class ConfigDto {
  @IsNotEmpty()
  NODE_ENV!: string;

  @IsNotEmpty()
  @IsNumber()
  @Transform(x => +x.value)
  PORT!: number;

  /** The same secret as the User Service: the apps' tokens are checked here too. */
  @IsNotEmpty()
  JWT_SECRET!: string;

  /** The ONNX model (YOLO26 exported once with Ultralytics, outside this repo). */
  @IsNotEmpty()
  @IsString()
  MODEL_PATH!: string;

  /** Class index → label (models/classes.json). */
  @IsNotEmpty()
  @IsString()
  MODEL_CLASSES_PATH!: string;

  /** onnxruntime execution provider: cpu (default) or cuda (needs the CUDA build). */
  @IsOptional()
  @IsString()
  MODEL_PROVIDER?: string;

  /**
   * CPU threads one copy of the model may use (0 or unset: all cores): each model worker of the
   * pool (MODEL_WORKERS), and the photo counter's worker. On a server: cores ÷ (MODEL_WORKERS + 1
   * for photos), e.g. 1 on 1-2 vCPU, 3 on 8 vCPU. Unset on a busy server: every copy takes every
   * core and they slow each other. With MODEL_WORKERS=0 each camera has its own copy: cores ÷
   * (cameras + 1).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(64)
  @Transform(x => +x.value)
  MODEL_THREADS?: number;

  /**
   * Model workers per model, shared by the cameras (one copy of the model each, however many
   * cameras): 1 by default; 2 or more on a big server when one cannot keep up; 0 = no pool, a
   * copy in every camera (the old way).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(16)
  @Transform(x => +x.value)
  MODEL_WORKERS?: number;

  /**
   * Most frames of different cameras one model run may take together; 4 by default. Only used
   * when the model was exported with a dynamic batch (else one at a time); 1 = never batch.
   */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(16)
  @Transform(x => +x.value)
  MODEL_BATCH?: number;

  /** MODEL_PATH=ultralytics:<endpoint url>: the Ultralytics Platform API key. */
  @IsOptional()
  @IsString()
  ULTRALYTICS_API_KEY?: string;

  /**
   * A model on Ultralytics Platform for chosen cameras: its dedicated endpoint
   * (https://….run.app/predict) or the shared one (…/api/models/<owner>/<project>/<model>/predict,
   * 20 requests a minute: tests only). Set with ULTRALYTICS_API_KEY, a camera can be set to run on it
   * (camera model "ultralytics": the warehouse app's camera settings → Where the model runs); the
   * others keep MODEL_PATH. The service still reads the camera and counts: only frames go out.
   */
  @IsOptional()
  @IsString()
  ULTRALYTICS_ENDPOINT_URL?: string;

  /** Frames a second read from a camera that has none of its own. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(30)
  @Transform(x => +x.value)
  DEFAULT_FPS?: number;

  /** Detection confidence for a camera that has none of its own (0–1). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Transform(x => +x.value)
  DEFAULT_CONF?: number;

  /**
   * Folders a photo-folder count may read, comma separated, relative to the service's folder or
   * absolute; unset = photos,test-videos. Nothing outside them can be read.
   */
  @IsOptional()
  @IsString()
  PHOTO_ROOTS?: string;

  /**
   * The parcel model for photo counts (an open-vocabulary YOLO-World export, see README); unset =
   * models/parcel-world-m.onnx (else parcel-world-l.onnx) when it is there, else the cameras' MODEL_PATH.
   */
  @IsOptional()
  @IsString()
  PHOTO_MODEL_PATH?: string;

  /** Its input size in pixels (the export's imgsz); 1280 by default. */
  @IsOptional()
  @IsNumber()
  @Min(320)
  @Max(2048)
  @Transform(x => +x.value)
  PHOTO_MODEL_SIZE?: number;

  /**
   * The parcel look-alike model for Count photos (CLIP's image encoder, see
   * Jalat-Ultralytics-Service/export_parcel_embedder.py): with it, each counted parcel comes with
   * an embedding, and the app suggests parcels already in another photo. Unset =
   * models/parcel-embed.onnx when it is there; "off" = none.
   */
  @IsOptional()
  @IsString()
  PHOTO_EMBED_PATH?: string;

  /** Its default confidence (0–1) when the app sends none; 0.06 by default (parcels wrapped in paper score low). */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(0.95)
  @Transform(x => +x.value)
  PHOTO_CONF?: number;

  /** How many days back a counted photo is compared with earlier ones for copies; 7 by default. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(365)
  @Transform(x => +x.value)
  PHOTO_DUP_DAYS?: number;

  /** Photos that may wait to be counted (all users); past it the API answers 429. 60 by default. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  @Transform(x => +x.value)
  PHOTO_QUEUE_MAX?: number;

  /** Photos one user may have waiting; past it 429 (other users still get their turn). 20 by default. */
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(10000)
  @Transform(x => +x.value)
  PHOTO_QUEUE_PER_USER?: number;

  /** "off": count photos in the API's own thread instead of a worker thread (to debug). */
  @IsOptional()
  @IsString()
  PHOTO_WORKER?: string;

  /** ffmpeg to read the cameras with; unset = the one bundled by ffmpeg-static. */
  @IsOptional()
  @IsString()
  FFMPEG_PATH?: string;
}
