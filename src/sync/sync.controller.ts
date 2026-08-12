import { Controller, Post, Get } from '@nestjs/common';
import { GtfsStaticSyncService } from './gtfs-static-sync.service';

@Controller('sync')
export class SyncController {
  constructor(private readonly staticSyncService: GtfsStaticSyncService) {}

  @Post('static')
  async triggerManualSync() {
    return this.staticSyncService.runSync();
  }

  @Get('status')
  getSyncInfo() {
    return {
      service: 'lmt-transit-bridge',
      syncType: 'GTFS Static & Realtime Sync',
      weeklyCron: 'Every Sunday at 02:00 AM UTC',
      manualTriggerEndpoint: 'POST /sync/static',
      timestamp: new Date().toISOString(),
    };
  }
}
