import { MqttClient } from 'mqtt';

export class MQTTService {
  constructor(public readonly client: MqttClient) {}
}
