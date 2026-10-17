import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class MQTTConfig {
  @IsNotEmpty()
  @IsString()
  MQTT_HOST!: string;

  @IsNotEmpty()
  @Transform(x => +x, { toPlainOnly: true })
  MQTT_PORT!: number;

  @IsNotEmpty()
  @IsString()
  MQTT_USER!: string;

  @IsNotEmpty()
  @IsString()
  MQTT_PASS!: string;
}
