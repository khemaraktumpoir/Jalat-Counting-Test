import { Logger } from '@nestjs/common';
import * as MQTT from 'mqtt';

import { ConfigService } from '@lib/config';

import { MQTTConfig } from './mqtt.dto';
import { MQTTService } from './mqtt.service';

const logger = new Logger('MQTTModule');

// Publish only: the live counts and worker status (C.mqttCameraCountTopic / mqttCameraStatusTopic).
let service: MQTTService;

export const MQTTProvider = {
  inject: [ConfigService],
  provide: MQTTService,
  useFactory: (configService: ConfigService) => {
    const { MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASS } = configService.validate(
      'MQTTModule',
      MQTTConfig
    );

    if (service) return service;

    const client = MQTT.connect(MQTT_HOST, {
      host: MQTT_HOST,
      port: MQTT_PORT,
      username: MQTT_USER,
      password: MQTT_PASS
    });
    client.on('connect', () => logger.log('MQTT server has connected successfully.'));
    client.on('error', e => logger.error(`MQTT: ${e.message}`));

    service = new MQTTService(client);
    return service;
  }
};
