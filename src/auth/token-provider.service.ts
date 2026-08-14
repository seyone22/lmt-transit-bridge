import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TokenProviderService {
  private readonly logger = new Logger(TokenProviderService.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0; // Unix timestamp in seconds

  /**
   * Retrieves a valid JWT token. Uses in-memory cache if valid.
   * If expired or forceRefresh is true, dynamically fetches fresh token from LMT Go
   * via lightweight HTTP Next.js chunk graph traversal (no Playwright, no hardcoded secrets).
   */
  async getOrRefreshToken(forceRefresh = false): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);

    // Return cached token if valid and not expiring within 5 minutes
    if (!forceRefresh && this.cachedToken && this.tokenExpiresAt > nowSec + 300) {
      return this.cachedToken;
    }

    this.logger.log('Token expired or refresh requested. Resolving fresh live JWT from LMT Go via HTTP...');

    try {
      const freshToken = await this.fetchFreshTokenViaHttp();
      if (freshToken) {
        this.updateCachedToken(freshToken);
        this.logger.log('✅ Success: Resolved fresh live JWT from LMT Go via HTTP chunk graph.');
        return freshToken;
      }
    } catch (err: any) {
      this.logger.error(`HTTP fresh token resolution failed: ${err.message}`);
    }

    if (this.cachedToken && this.tokenExpiresAt > nowSec) {
      this.logger.warn('Falling back to currently cached token despite refresh attempt.');
      return this.cachedToken;
    }

    throw new Error('Failed to resolve fresh JWT token from LMT Go upstream service.');
  }

  /**
   * Dynamically extracts fresh JWT Bearer token from LMT Go by fetching RSC page data
   * and traversing Next.js chunk graph over lightweight HTTP GET calls.
   */
  private async fetchFreshTokenViaHttp(): Promise<string | null> {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
    };

    // 1. Fetch RSC page manifest for smartmetro
    const rscUrl = 'https://lankametro.lk/en/smartmetro/__next.%24d%24locale.smartmetro.__PAGE__.txt?_rsc=1';
    let queue: string[] = [];

    try {
      const rscRes = await axios.get(rscUrl, { headers, timeout: 5000 });
      if (typeof rscRes.data === 'string') {
        const chunkNames = [...new Set(rscRes.data.match(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g) || [])];
        queue = chunkNames.map((c) => `https://lankametro.lk/_next/${c}`);
      }
    } catch (e: any) {
      this.logger.warn(`Could not fetch RSC page manifest: ${e.message}. Falling back to main page scan...`);
      queue.push('https://lankametro.lk/en/smartmetro');
    }

    const visited = new Set(queue);

    // 2. Traverse chunk graph until valid JWT is found
    while (queue.length > 0) {
      const chunkUrl = queue.shift()!;
      try {
        const res = await axios.get(chunkUrl, { headers, timeout: 4000 });
        if (typeof res.data === 'string') {
          if (res.data.includes('eyJ')) {
            const tokens = res.data.match(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g);
            if (tokens && tokens.length > 0) {
              for (const tok of tokens) {
                try {
                  const parts = tok.split('.');
                  if (parts.length >= 2) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
                    if (payload.exp && (payload.user_id || payload.sub)) {
                      return tok;
                    }
                  }
                } catch (e) {}
              }
            }
          }

          // Discover inner chunk dependencies
          const innerChunks = [...new Set(res.data.match(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g) || [])];
          for (const ic of innerChunks) {
            const fullUrl = `https://lankametro.lk/_next/${ic}`;
            if (!visited.has(fullUrl)) {
              visited.add(fullUrl);
              queue.push(fullUrl);
            }
          }
        }
      } catch (e) {}
    }

    return null;
  }

  private updateCachedToken(token: string) {
    this.cachedToken = token;
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        if (payload.exp && typeof payload.exp === 'number') {
          this.tokenExpiresAt = payload.exp;
          const expDate = new Date(payload.exp * 1000).toISOString();
          this.logger.log(`JWT payload decoded successfully. Token Expiration: ${expDate}`);
        }
      }
    } catch (e) {
      this.tokenExpiresAt = Math.floor(Date.now() / 1000) + 86400;
    }
  }
}

