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
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const pages = [
      'https://lankametro.lk/en/smartmetro',
      'https://lankametro.lk/en',
      'https://lankametro.lk',
    ];

    const scriptUrls = new Set<string>();

    // 1. Discover all static chunk script URLs from page HTML
    for (const pageUrl of pages) {
      try {
        const res = await axios.get(pageUrl, { headers, timeout: 5000 });
        if (typeof res.data === 'string') {
          const matches = res.data.match(/src=["']([^"']+\.js[^"']*)["']/g) || [];
          matches.forEach((m) => {
            let src = m.replace(/^src=["']/, '').replace(/["']$/, '');
            if (src.startsWith('/')) src = 'https://lankametro.lk' + src;
            scriptUrls.add(src);
          });
        }
      } catch (e: any) {
        this.logger.warn(`Could not fetch page ${pageUrl}: ${e.message}`);
      }
    }

    // 2. Scan script chunks for a valid JWT token
    for (const sUrl of scriptUrls) {
      try {
        const res = await axios.get(sUrl, { headers: { 'User-Agent': headers['User-Agent'] }, timeout: 4000 });
        if (typeof res.data === 'string' && res.data.includes('eyJ')) {
          const tokens = res.data.match(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g) || [];
          for (const tok of tokens) {
            try {
              const parts = tok.split('.');
              if (parts.length >= 2) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
                if (payload.exp && (payload.user_id || payload.sub || payload.user_type)) {
                  this.logger.log(`Found valid JWT token in script ${sUrl}`);
                  return tok;
                }
              }
            } catch (e) {}
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

