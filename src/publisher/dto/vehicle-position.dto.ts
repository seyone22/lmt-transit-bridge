export interface CreateVehiclePositionDto {
  trip_id: string;
  route_id?: string;
  direction_id?: number;
  vehicle_id?: string;
  vehicle_label?: string;
  license_plate?: string;
  latitude: number;
  longitude: number;
  bearing?: number;
  speed?: number;
  timestamp?: string;
}
