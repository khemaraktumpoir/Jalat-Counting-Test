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
   * CPU threads one camera's model may use (0 or unset: all cores). On a small server: cores ÷
   * cameras, e.g. 1 on 1 vCPU, 2 on 4 vCPU with 2 cameras.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(64)
  @Transform(x => +x.value)
  MODEL_THREADS?: number;

  /** MODEL_PATH=ultralytics:<endpoint url>: the Ultralytics Platform API key. */
  @IsOptional()
  @IsString()
  ULTRALYTICS_API_KEY?: string;

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
   * absolute; unset = photos,samples. Nothing outside them can be read.
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

  /** ffmpeg to read the cameras with; unset = the one bundled by ffmpeg-static. */
  @IsOptional()
  @IsString()
  FFMPEG_PATH?: string;
}
