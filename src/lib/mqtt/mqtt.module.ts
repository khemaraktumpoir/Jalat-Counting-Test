import { Global, Module } from '@nestjs/common';

import { MQTTProvider } from './mqtt.provider';
import { MQTTService } from './mqtt.service';

@Global()
@Module({
  providers: [MQTTProvider],
  exports: [MQTTProvider, MQTTService]
})
export class MQTTModule {}
