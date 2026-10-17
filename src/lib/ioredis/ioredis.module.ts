import { Global, Module } from '@nestjs/common';

import { IORedisProvider } from './ioredis.provider';

@Global()
@Module({
  providers: [IORedisProvider],
  exports: [IORedisProvider]
})
export class IORedisModule {}
