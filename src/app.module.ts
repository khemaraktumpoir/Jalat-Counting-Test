import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { ConfigModule } from '@lib/config';
import { IORedisModule } from '@lib/ioredis';
import { JwtModule } from '@lib/jwt';
import { MQTTModule } from '@lib/mqtt';
import { TypeOrmModule } from '@lib/typeorm';

import { ApiModule } from './api/api.module';
import { GraphQLAPIModule } from './graphql/graphql.module';

@Module({
  imports: [
    // -----
    ApiModule,
    ConfigModule,
    GraphQLAPIModule,
    IORedisModule,
    JwtModule,
    MQTTModule,
    ScheduleModule.forRoot(),
    TypeOrmModule
  ]
})
export class ApplicationModule {}
