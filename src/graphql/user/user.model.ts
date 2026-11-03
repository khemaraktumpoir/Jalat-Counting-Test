import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
class Zone {
  @Field()
  id!: string;

  @Field()
  commune!: string;
}

@ObjectType()
class DriverProfile {
  @Field(() => Zone, { nullable: true })
  zone!: Zone;
}

@ObjectType()
export class BankAccount {
  @Field()
  accountType!: string;

  @Field()
  accountNumber!: string;

  @Field({ nullable: true })
  accountName?: string;
}

@ObjectType()
class ZonePickup {
  @Field(() => String)
  id!: string;

  @Field(() => String)
  zoneName!: string;
}

@ObjectType()
class PickupPrimaryZone {
  @Field(() => ZonePickup)
  zone!: ZonePickup;
}
@ObjectType()
class DriverZone {
  @Field(() => PickupPrimaryZone)
  pickupPrimaryZone!: PickupPrimaryZone;
}

@ObjectType()
export class User {
  @Field()
  id!: string;

  @Field()
  username!: string;

  @Field({ nullable: true })
  fullName?: string;

  @Field()
  userType!: string;

  @Field()
  phoneNumber!: string;

  @Field(() => String, { nullable: true })
  dob?: string;

  @Field({ nullable: true })
  gender?: string;

  @Field({ nullable: true, defaultValue: '' })
  avatar?: string;

  @Field()
  status!: string;

  @Field(() => String, { nullable: true })
  createdAt!: string;

  @Field(() => String, { nullable: true })
  updatedAt!: string;

  @Field(() => DriverProfile, { nullable: true })
  driverProfile?: DriverProfile;

  @Field(() => [BankAccount], { nullable: true })
  bankAccounts?: BankAccount[];

  @Field(() => DriverZone, { nullable: true })
  driverZone?: DriverZone;

  /** Not in the schema: the token's role and what it may do here (set by the auth guard). */
  roleId?: number | null;
  permissions?: string[];
}
