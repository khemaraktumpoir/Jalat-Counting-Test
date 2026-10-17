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

  /** ffmpeg to read the cameras with; unset = the one bundled by ffmpeg-static. */
  @IsOptional()
  @IsString()
  FFMPEG_PATH?: string;
}
