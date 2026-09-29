import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface UpstreamRoute {
  id: number;
  route_code: string;
  name: string;
  name_si: string;
  name_ta: string;
  color_hex: string;
  status: string;
}

export interface UpstreamStop {
  id: number;
  stop_code: string;
  eimsky_id: string;
  name: string;
  name_si: string;
  name_ta: string;
  lat: number;
  lng: number;
  is_metro: number;
  direction_name: string;
}

export interface UpstreamFareEntry {
  id: string;
  route_id: number;
  route_code: string;
  direction_id: string;
  from_stop_id: number;
  to_stop_id: number;
  from_seq: number;
  to_seq: number;
  full_amount_lkr: number;
  half_amount_lkr: number;
}

export interface ExtractedTransitData {
  routes: UpstreamRoute[];
  stops: UpstreamStop[];
  fareMatrix: UpstreamFareEntry[];
  directionMap: Map<string, string[]>; // route_code -> direction_ids
  eimskyRouteIdMap: Map<string, string>; // route_code -> primary route_id / UUID
}

@Injectable()
export class LmtSourceExtractorService {
  private readonly logger = new Logger(LmtSourceExtractorService.name);
  private cachedData: ExtractedTransitData | null = null;
  private lastFetchedAt = 0;

  private readonly knownChunkUrl = 'https://lankametro.lk/_next/static/chunks/04zlm32ou8r3k.js';

  async getTransitData(forceRefresh = false): Promise<ExtractedTransitData> {
    const now = Date.now();
    // Cache for 24 hours unless forceRefresh
    if (!forceRefresh && this.cachedData && now - this.lastFetchedAt < 24 * 3600 * 1000) {
      return this.cachedData;
    }

    this.logger.log('🌐 Fetching direct-from-source transit metadata from LMT production chunk manifest...');
    try {
      const chunkCode = await this.fetchLatestRouteChunkCode();
      const extracted = this.parseChunkCode(chunkCode);
      this.cachedData = extracted;
      this.lastFetchedAt = now;
      this.logger.log(
        `✅ Successfully extracted ${extracted.routes.length} routes, ${extracted.stops.length} stops, and ${extracted.fareMatrix.length} fare rules direct from source!`,
      );
      return extracted;
    } catch (err: any) {
      this.logger.error(`Failed to extract data direct from source: ${err.message}`);
      if (this.cachedData) return this.cachedData;
      throw err;
    }
  }

  private async fetchLatestRouteChunkCode(): Promise<string> {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    // 1. Try discovering dynamically from page scripts
    try {
      const pageRes = await axios.get('https://lankametro.lk/en/smartmetro', { headers, timeout: 5000 });
      if (typeof pageRes.data === 'string') {
        const matches = pageRes.data.match(/src=["']([^"']+\.js[^"']*)["']/g) || [];
        for (const m of matches) {
          let src = m.replace(/^src=["']/, '').replace(/["']$/, '');
          if (src.startsWith('/')) src = 'https://lankametro.lk' + src;
          if (src.includes('static/chunks/')) {
            try {
              const chunkRes = await axios.get(src, { headers, timeout: 5000 });
              if (typeof chunkRes.data === 'string' && chunkRes.data.includes('route_code:"CM08"')) {
                this.logger.log(`Found live route chunk at ${src}`);
                return chunkRes.data;
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      this.logger.warn(`Dynamic chunk discovery notice: ${e.message}`);
    }

    // 2. Fallback to known production chunk
    this.logger.log(`Falling back to known production chunk URL: ${this.knownChunkUrl}`);
    const res = await axios.get(this.knownChunkUrl, { headers, timeout: 8000 });
    if (typeof res.data !== 'string') {
      throw new Error('Upstream chunk response was not valid text JavaScript');
    }
    return res.data;
  }

  private parseChunkCode(chunkCode: string): ExtractedTransitData {
    // 1. Parse routes
    const routesMatch = chunkCode.match(/\[\{id:1,route_code:"CM01"[\s\S]*?\}\]/);
    if (!routesMatch) {
      throw new Error('Could not find routes array in upstream JavaScript chunk');
    }
    const routes: UpstreamRoute[] = eval(`(${routesMatch[0]})`);

    // 2. Parse stops
    const stopsMatch = chunkCode.match(/\[\{id:1,stop_code:[\s\S]*?\}\]/);
    if (!stopsMatch) {
      throw new Error('Could not find stops array in upstream JavaScript chunk');
    }
    const stops: UpstreamStop[] = eval(`(${stopsMatch[0]})`);

    // 3. Parse fare matrix
    const fareMatch = chunkCode.match(/\[\{id:"[0-9a-f-]{36}",route_id:1,route_code:"CM01"[\s\S]*?\}\]/);
    let fareMatrix: UpstreamFareEntry[] = [];
    if (fareMatch) {
      fareMatrix = eval(`(${fareMatch[0]})`);
    }

    // 4. Build direction map (route_code -> direction UUIDs)
    const directionMap = new Map<string, string[]>();
    for (const f of fareMatrix) {
      if (!directionMap.has(f.route_code)) {
        directionMap.set(f.route_code, []);
      }
      const dirList = directionMap.get(f.route_code)!;
      if (!dirList.includes(f.direction_id)) {
        dirList.push(f.direction_id);
      }
    }

    // 5. Build Eimsky UUID mappings for each route
    // CM01 & CM02 retain established UUIDs, others have canonical IDs
    const eimskyRouteIdMap = new Map<string, string>([
      ['CM01', '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5'],
      ['CM02', 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8'],
      ['CM03', 'c0030000-0000-4000-8000-000000000003'],
      ['CM04', 'c0040000-0000-4000-8000-000000000004'],
      ['CM05', 'c0050000-0000-4000-8000-000000000005'],
      ['CM06', 'c0060000-0000-4000-8000-000000000006'],
      ['CM08', 'c0080000-0000-4000-8000-000000000008'],
    ]);

    return {
      routes,
      stops,
      fareMatrix,
      directionMap,
      eimskyRouteIdMap,
    };
  }
}
