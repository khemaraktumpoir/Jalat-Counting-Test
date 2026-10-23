import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as compression from 'compression';
import * as express from 'express';
import helmet from 'helmet';
import * as morgan from 'morgan';
import { resolve } from 'path';

import { AppExceptionFilter, swaggerDescription, swaggerOptions } from '@common';
import { GqlAuthGuard, GqlAuthModule } from '@graphql/auth';
import { ConfigModule, ConfigService } from '@lib/config';

import { ApplicationModule } from './app.module';

declare const module: any;

async function bootstrap() {
  // ! This is for localhost development only
  // http://backend.pathmazing.com/docs/tips/localhost-certificate
  // const httpsOptions = {
  //   key: readFileSync(resolve('.', 'config', 'ssl', 'localhost-key.pem')),
  //   cert: readFileSync(resolve('.', 'config', 'ssl', 'localhost.pem'))
  // };
  const app = await NestFactory.create<NestExpressApplication>(ApplicationModule);

  // =================================
  // configureExpressSettings
  // =================================
  app.set('etag', 'strong');
  app.set('trust proxy', true);
  app.set('x-powered-by', false);

  // =================================
  // configureExpressMiddleware
  // =================================
  // app.use('/', express.static('public'));
  app.enableCors({ origin: true });
  app.useStaticAssets(resolve('.', 'public'));
  app.use(express.json({ limit: '5mb' }));
  // A phone camera's frames (POST /api/v1/counting/cameras/:id/frames): one JPEG each.
  app.use(express.raw({ type: 'image/jpeg', limit: '3mb' }));
  app.use(compression());
  app.use(helmet({ contentSecurityPolicy: { reportOnly: true } }));
  // Not one log line per phone frame (several a second).
  app.use(
    morgan('dev', { skip: req => req.method === 'POST' && /\/frames(\?|$)/.test(req.url ?? '') })
  );

  // =================================
  // configureNestGlobals
  // =================================
  const config = app.select(ConfigModule).get(ConfigService, { strict: true });

  const gqlAuthGuard = app.select(GqlAuthModule).get(GqlAuthGuard);
  app.useGlobalGuards(gqlAuthGuard);

  // app.useWebSocketAdapter(new RedisIoAdapter(app, config));
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      errorHttpStatusCode: 422
    })
  );
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/v'
  });

  // =================================
  // configureNestSwagger
  // =================================
  if (config.env.NODE_ENV !== 'production') {
    const options = new DocumentBuilder()
      .setTitle('Jalat Counting Service')
      .setContact('', '', '')
      .setDescription(swaggerDescription)
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    // https://github.com/swagger-api/swagger-ui/blob/master/docs/usage/configuration.md
    const document = SwaggerModule.createDocument(app, options);
    SwaggerModule.setup('/api/docs', app, document, { swaggerOptions });
  }

  // =================================
  // configureNestConfig
  // =================================
  const port = config.env.PORT;
  await app.listen(port).then(x => console.log(`Listen on port ${port}`));

  // =================================
  // configureNestHotReload
  // =================================
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}

// A failed start (the model, the database not reachable, a bad config value…) is said in one
// line and exits with a failure code, so pm2 / the container restarts the service — instead
// of an unhandled rejection that prints only the library line it came from.
bootstrap().catch(error => {
  Logger.error(`Startup failed: ${error?.message ?? error}`, error?.stack, 'Bootstrap');
  process.exit(1);
});
