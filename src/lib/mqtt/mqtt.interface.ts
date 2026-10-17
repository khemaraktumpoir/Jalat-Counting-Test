export class UpdateLocationPayload {
  driverId!: string;
  lat!: number;
  lon!: number;
  driverShift!: number;
  shiftType!: number;
}

export class UpdatePickupLocationPayload {
  driverId!: string;
  orderId!: string;
  lat!: number;
  lon!: number;
  pickupShift!: string;
}
