import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TokenProviderService {
  private readonly logger = new Logger(TokenProviderService.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0; // Unix timestamp in seconds
  private sessionCookies: string = '';
  private refreshPromise: Promise<string> | null = null;

  /**
   * Retrieves a valid JWT token. Uses in-memory cache if valid.
   * If expired or forceRefresh is true, dynamically fetches fresh token from LMT Next.js
   * via lightweight HTTP RSC chunk graph traversal (no Playwright, no hardcoded secrets).
   */
  async getOrRefreshToken(forceRefresh = false): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);

    // Return cached token if valid and not expiring within 5 minutes
    if (!forceRefresh && this.cachedToken && this.tokenExpiresAt > nowSec + 300) {
      return this.cachedToken;
    }

    // Coalesce concurrent refresh calls into a single in-flight promise
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      this.logger.log('Token expired or refresh requested. Resolving fresh live JWT from LMT Next.js chunk graph...');

      // 1. Check environment variable override
      if (process.env.LMT_JWT_TOKEN && process.env.LMT_JWT_TOKEN.trim().length > 30) {
        const envToken = process.env.LMT_JWT_TOKEN.trim();
        if (this.isTokenValid(envToken)) {
          this.updateCachedToken(envToken);
          this.logger.log('✅ Loaded valid JWT from LMT_JWT_TOKEN environment variable.');
          return envToken;
        }
      }

      // 2. Fetch fresh token dynamically via RSC chunk discovery
      try {
        const freshToken = await this.fetchFreshTokenViaHttp();
        if (freshToken) {
          this.updateCachedToken(freshToken);
          this.logger.log('✅ Success: Resolved fresh live JWT from LMT Next.js chunk graph.');
          return freshToken;
        }
      } catch (err: any) {
        this.logger.error(`HTTP fresh token resolution failed: ${err.message}`);
      }

      // 3. Fallback to existing cached token if not yet strictly expired
      if (this.cachedToken && this.tokenExpiresAt > nowSec) {
        this.logger.warn('Falling back to currently cached token despite refresh attempt.');
        return this.cachedToken;
      }

      throw new Error('Failed to resolve fresh JWT token from LMT Go upstream service.');
    })().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  public forceRefreshToken(): Promise<string> {
    return this.getOrRefreshToken(true);
  }

  public getTokenExpiresAt(): number {
    return this.tokenExpiresAt;
  }

  public hasValidToken(): boolean {
    return !!this.cachedToken && this.tokenExpiresAt > Math.floor(Date.now() / 1000);
  }

  private isTokenValid(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        const nowSec = Math.floor(Date.now() / 1000);
        return typeof payload.exp === 'number' && payload.exp > nowSec;
      }
    } catch {}
    return false;
  }

  /**
   * Dynamically extracts fresh JWT Bearer token from LMT Go by fetching RSC page data
   * and traversing Next.js chunk graph over lightweight HTTP GET calls.
   */
  private async fetchFreshTokenViaHttp(): Promise<string | null> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (this.sessionCookies) {
      headers['Cookie'] = this.sessionCookies;
    }

    // 1. Initial session handshake to establish Cloudflare cookies if not present
    try {
      const initRes = await axios.get('https://lankametro.lk/en/smartmetro', { headers, timeout: 6000 });
      if (initRes.headers['set-cookie']) {
        const cookies = Array.isArray(initRes.headers['set-cookie'])
          ? initRes.headers['set-cookie']
          : [initRes.headers['set-cookie']];
        this.sessionCookies = cookies.map((c) => c.split(';')[0]).join('; ');
        headers['Cookie'] = this.sessionCookies;
      }
    } catch (e: any) {
      this.logger.debug?.(`Session handshake notice: ${e.message}`);
    }

    const scriptUrls = new Set<string>();

    // 2. Discover static chunk scripts from Next.js RSC manifest
    const rscUrl = 'https://lankametro.lk/en/smartmetro/__next.%24d%24locale.smartmetro.__PAGE__.txt?_rsc=1';
    try {
      const rscRes = await axios.get(rscUrl, { headers, timeout: 6000 });
      if (typeof rscRes.data === 'string') {
        const chunkNames = [...new Set(rscRes.data.match(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g) || [])];
        chunkNames.forEach((c) => scriptUrls.add(`https://lankametro.lk/_next/${c}`));
      }
    } catch (e: any) {
      this.logger.debug?.(`RSC chunk traversal notice: ${e.message}`);
    }

    // 3. Fallback discovery: scrape HTML script tags across main pages
    const pages = [
      'https://lankametro.lk/en/smartmetro',
      'https://lankametro.lk/en',
      'https://lankametro.lk',
    ];

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
      } catch (e: any) {}
    }

    // 4. Scan script chunks for a valid JWT token
    const urlList = Array.from(scriptUrls);
    for (const sUrl of urlList) {
      try {
        const res = await axios.get(sUrl, {
          headers: { 'User-Agent': headers['User-Agent'], ...(this.sessionCookies ? { Cookie: this.sessionCookies } : {}) },
          timeout: 4500,
        });
        if (typeof res.data === 'string' && res.data.includes('eyJ')) {
          const tokens = res.data.match(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g) || [];
          for (const tok of tokens) {
            try {
              const parts = tok.split('.');
              if (parts.length >= 2) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
                if (payload.exp && (payload.user_id || payload.sub || payload.user_type)) {
                  this.logger.log(`Found valid JWT token in chunk: ${sUrl.split('/').pop()}`);
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
