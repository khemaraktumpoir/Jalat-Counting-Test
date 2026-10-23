import { Module } from '@nestjs/common';

import { CountingModule } from '@graphql/counting';
import * as Repositories from '@repositories';

import { CountingController } from './counting/counting.controller';
import { PhotosController } from './counting/photos.controller';
import { HealthController } from './health/health.controller';
import { HomeController } from './health/home.controller';

@Module({
  imports: [CountingModule],
  controllers: [CountingController, PhotosController, HealthController, HomeController],
  providers: [...Object.values(Repositories)]
})
export class ApiModule {}
