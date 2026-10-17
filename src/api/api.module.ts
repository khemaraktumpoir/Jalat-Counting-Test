import { Module } from '@nestjs/common';

import { CountingModule } from '@graphql/counting';
import * as Repositories from '@repositories';

import { CountingController } from './counting/counting.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [CountingModule],
  controllers: [CountingController, HealthController],
  providers: [...Object.values(Repositories)]
})
export class ApiModule {}
