import { Args } from '@nestjs/graphql';

export const ArgsId = () => Args('id', { type: () => String, nullable: false });
