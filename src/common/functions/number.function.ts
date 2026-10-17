import { ValueTransformer } from 'typeorm';

export const ValueTransformToNumber: ValueTransformer = {
  to: (entityValue: number) => entityValue,
  from: (databaseValue: string): number => (!databaseValue ? 0 : Number(databaseValue))
};
