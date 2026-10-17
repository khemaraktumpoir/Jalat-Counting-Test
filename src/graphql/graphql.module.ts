import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { GraphQLFormattedError } from 'graphql';
import { join } from 'path';

import { ConfigModule, ConfigService } from '@lib/config';

import { GqlAuthModule } from './auth';
import { CountingModule } from './counting';

// Expected client-caused errors — safe to drop the stacktrace. Anything else keeps it (real bug).
const CLIENT_ERROR_CODES = new Set(['UNAUTHENTICATED', 'FORBIDDEN', 'BAD_USER_INPUT']);

export function formatGraphQLError(formattedError: GraphQLFormattedError): GraphQLFormattedError {
  const code = formattedError.extensions?.code as string | undefined;
  if (!code || !CLIENT_ERROR_CODES.has(code)) return formattedError;

  return {
    message: formattedError.message,
    locations: formattedError.locations,
    path: formattedError.path,
    extensions: { code }
  };
}

@Module({
  imports: [
    GqlAuthModule,
    CountingModule,
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        return {
          path: 'v1',
          sortSchema: false,
          playground: config.env.NODE_ENV == 'development',
          driver: ApolloDriver,
          autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
          context: ({ req }) => ({ req }),
          formatError: formatGraphQLError
        };
      }
    })
  ]
})
export class GraphQLAPIModule {}
