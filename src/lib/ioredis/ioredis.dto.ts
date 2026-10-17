import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class IORedisConfig {
  @IsNotEmpty()
  @IsString()
  REDIS_HOST!: string;

  @IsNotEmpty()
  @IsNumber()
  @Transform(x => +x.value)
  REDIS_PORT!: number;

  /** Empty for a local Redis without a password (docker-compose.yml). */
  @IsOptional()
  @IsString()
  REDIS_AUTH_PASS?: string;
}
