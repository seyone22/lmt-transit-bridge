import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LmtWebsocketService } from './lmt/lmt-websocket.service';
import { GtfsRealtimePublisherService } from './publisher/gtfs-realtime-publisher.service';
import { TokenProviderService } from './auth/token-provider.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    LmtWebsocketService,
    GtfsRealtimePublisherService,
    TokenProviderService,
  ],
})
export class AppModule {}
