import { Controller, Get } from '@nestjs/common';
import { LmtWebsocketService } from '../lmt/lmt-websocket.service';

@Controller('health')
export class HealthController {
  constructor(private readonly lmtWsService: LmtWebsocketService) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'lmt-transit-bridge',
      timestamp: new Date().toISOString(),
      smartMetroConnected: this.lmtWsService.getIsConnected(),
    };
  }
}
