import { Controller, Get } from '@nestjs/common';
import { LmtWebsocketService } from '../lmt/lmt-websocket.service';
import { TokenProviderService } from '../auth/token-provider.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly lmtTelemetryService: LmtWebsocketService,
    private readonly tokenProvider: TokenProviderService,
  ) {}

  @Get()
  getHealth() {
    const isWsStreaming = this.lmtTelemetryService.isWsActivelyStreaming();
    const isConnected = this.lmtTelemetryService.getIsConnected();
    const expiresAtSec = this.tokenProvider.getTokenExpiresAt();
    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSeconds = expiresAtSec > 0 ? Math.max(0, expiresAtSec - nowSec) : 0;

    return {
      status: 'ok',
      service: 'lmt-transit-bridge',
      timestamp: new Date().toISOString(),
      upstream: {
        status: this.lmtTelemetryService.getUpstreamStatus(),
        transport: isWsStreaming ? 'websocket' : 'http_edge_fallback',
        activeBusesCount: this.lmtTelemetryService.getActiveBusesCount(),
        adaptiveCadenceMs: this.lmtTelemetryService.getCurrentIntervalMs(),
        lastPoll: this.lmtTelemetryService.getLastPollTimestamp()
          ? new Date(this.lmtTelemetryService.getLastPollTimestamp()).toISOString()
          : null,
        trackedBuses: this.lmtTelemetryService.getTrackedBusesList(),
      },
      token: {
        isValid: isConnected || this.tokenProvider.hasValidToken(),
        expiresAt: expiresAtSec > 0 ? new Date(expiresAtSec * 1000).toISOString() : null,
        ttlSeconds: isConnected ? (ttlSeconds > 0 ? ttlSeconds : 86400) : ttlSeconds,
      },
    };
  }
}
