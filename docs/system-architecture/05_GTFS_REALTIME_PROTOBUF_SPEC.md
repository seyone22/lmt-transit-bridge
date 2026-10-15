# 05. GTFS-Realtime Protobuf Specification & Feeds

## 1. GTFS-Realtime Protocol Overview
The platform generates standard binary Protocol Buffer (Protobuf) feeds conforming to the **GTFS-Realtime v2.0** specification, maintained by MobilityData.

```
MIME Content-Type: application/x-protobuf
Serialization:     Protocol Buffers v2 / v3
Endpoints:
  - /api/v1/realtime/vehicle-positions
  - /api/v1/realtime/trip-updates
  - /api/v1/realtime/alerts
```

---

## 2. Feed Entity Dissection: `/realtime/vehicle-positions`

Every commercial bus actively operating on the corridor is serialized into a standard `FeedEntity`:

```protobuf
message FeedEntity {
  required string id = 1; // "vehicle-position-LMT_CM05_1_WP-NE-6488-0"
  optional VehiclePosition vehicle = 4;
}

message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 8;
  optional Position position = 2;
  optional OccupancyStatus occupancy_status = 9;
  optional uint32 occupancy_percentage = 10;
  repeated CarriageDetails multi_carriage_details = 11;
  optional uint64 timestamp = 5;
}
```

### Decoded Live Entity Example:
```json
{
  "id": "vehicle-position-LMT_CM05_1_WP-NE-6488-0",
  "vehicle": {
    "trip": {
      "tripId": "LMT_CM05_1_WP-NE-6488"
    },
    "vehicle": {
      "id": "WP-NE-6488",
      "label": "WP-NE-6488 (31/70 seats free)",
      "licensePlate": "WP-NE-6488"
    },
    "position": {
      "latitude": 6.95289,
      "longitude": 79.88058,
      "bearing": 182.4,
      "speed": 28.5
    },
    "occupancyStatus": 2, // FEW_SEATS_AVAILABLE
    "occupancyPercentage": 56,
    "multiCarriageDetails": [
      {
        "id": "1",
        "label": "39/70 occupied",
        "occupancyStatus": 2,
        "occupancyPercentage": 56,
        "carriageSequence": 1
      }
    ],
    "timestamp": 1729000850
  }
}
```

---

## 3. Feed Entity Dissection: `/realtime/trip-updates`

Propagates real-time arrival and departure delays per stop for schedule matching in journey planners:

```protobuf
message TripUpdate {
  required TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 3;
  repeated StopTimeUpdate stop_time_update = 2;
  optional int32 delay = 4; // in seconds
  optional uint64 timestamp = 5;
}
```
* **Arrival/Departure Delays**: Expressed in integer seconds (e.g. `+180` = 3 minutes behind schedule).
* **Schedule Relationship**: Set to `SCHEDULED`, or `ADDED` for unscheduled supplementary express services.

---

## 4. Feed Entity Dissection: `/realtime/alerts`

Exposes traffic disruptions, severe weather advisories, terminal rerouting, and expressway closures:

```protobuf
message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 5;
  optional Cause cause = 6;
  optional Effect effect = 7;
  optional TranslatedString header_text = 10;
  optional TranslatedString description_text = 11;
}
```
* **Informed Entities**: Tagged by `route_id`, `stop_id`, or agency-wide (`agency_id: "LMT"`).

---

## 5. Performance Engineering: Stale-While-Revalidate (SWR) Engine

Because Protobuf serialization can consume significant CPU cycles if executed on every consumer HTTP request:
1. **In-Memory Cache**: Feeds are serialized into binary `Buffer` objects in memory with a configurable TTL (default: `10,000ms` / 10 seconds).
2. **Immediate Cache Hit**: Incoming HTTP requests during the TTL window are served directly from RAM without database queries or Protobuf re-encoding (<15ms response time).
3. **Background Asynchronous Revalidation**: When the TTL expires, the first incoming request triggers a background revalidation while serving the cached payload, guaranteeing sub-second response times under heavy concurrent polling loads.
4. **Instant Invalidation**: Whenever a batch of new vehicle positions arrives from `lmt-transit-bridge`, the cache is invalidated so the next request immediately reflects fresh coordinates.
