import { Type } from '@nestjs/common';
import { ArgsType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { Type as TransformType } from 'class-transformer';
import { IsArray, IsInt, IsOptional, ValidateNested } from 'class-validator';

enum OrderBy {
  NATURAL
}

registerEnumType(OrderBy, { name: 'OrderBy' });

export function Filtered<T, U>(classRef: Type<T>, orderByRef?: U) {
  const OrderClass = orderByRef || OrderBy;
  @ArgsType()
  abstract class FilteredType<T, U> {
    // NOTE: these need class-validator decorators — the global ValidationPipe
    // runs with whitelist: true, which silently strips any property with no
    // validation decorator, so without these `filter`/`limit`/`offset`/`order`
    // all get wiped out to `{}` before reaching the resolver.
    @Field(() => classRef, { nullable: true })
    @IsOptional()
    @ValidateNested()
    @TransformType(() => classRef)
    filter!: T;

    @Field(() => Int, { nullable: true, defaultValue: 20 })
    @IsOptional()
    @IsInt()
    limit!: number;

    @Field(() => Int, { nullable: true, defaultValue: 0 })
    @IsOptional()
    @IsInt()
    offset!: number;

    @Field(() => [OrderClass], { nullable: true })
    @IsOptional()
    @IsArray()
    order?: U[];
  }
  return FilteredType as new () => FilteredType<T, U>;
}
