import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { chromium } from 'playwright';

@Injectable()
export class TokenProviderService {
  private readonly logger = new Logger(TokenProviderService.name);
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0; // Unix timestamp in seconds

  /**
   * Retrieves a valid JWT token. Uses in-memory cache if valid.
   * If expired or forceRefresh is true, tries Strategy 2 (Direct HTTP) first,
   * then falls back to Strategy 1 (Playwright Headless Browser).
   */
  async getOrRefreshToken(forceRefresh = false): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);

    // Return cached token if valid and not expiring within 5 minutes
    if (!forceRefresh && this.cachedToken && this.tokenExpiresAt > nowSec + 300) {
      return this.cachedToken;
    }

    this.logger.log('Token expired or refresh requested. Attempting Strategy 2 (Direct API Hook)...');

    // Strategy 2: Direct HTTP Guest Auth Hook
    try {
      const tokenFromApi = await this.tryDirectApiHook();
      if (tokenFromApi) {
        this.updateCachedToken(tokenFromApi);
        this.logger.log('✅ Strategy 2 Success: Obtained fresh JWT via Direct API Hook.');
        return tokenFromApi;
      }
    } catch (err: any) {
      this.logger.warn(`Strategy 2 (Direct API Hook) failed: ${err.message}`);
    }

    // Strategy 1: Headless Playwright Auto-Auth Fallback
    this.logger.log('⚠️ Falling back to Strategy 1 (Playwright Headless Auto-Auth)...');
    try {
      const tokenFromBrowser = await this.tryPlaywrightAutoAuth();
      if (tokenFromBrowser) {
        this.updateCachedToken(tokenFromBrowser);
        this.logger.log('⚡ Strategy 1 Success: Intercepted fresh JWT via Playwright browser session.');
        return tokenFromBrowser;
      }
    } catch (err: any) {
      this.logger.error(`Strategy 1 (Playwright Auto-Auth) failed: ${err.message}`);
    }

    // Ultimate fallback: Use env var or last known token
    const fallbackToken = process.env.LMT_WS_TOKEN || '';
    if (fallbackToken) {
      this.logger.warn('Using fallback environment variable LMT_WS_TOKEN.');
      this.updateCachedToken(fallbackToken);
      return fallbackToken;
    }

    throw new Error('All token refresh strategies (Direct API, Playwright, Fallback Env) failed.');
  }

  /**
   * Strategy 2: Direct API Hook
   */
  private async tryDirectApiHook(): Promise<string | null> {
    const resp = await axios.get('https://lankametro.lk/en/smartmetro', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 5000,
    });

    const html = resp.data;
    if (typeof html === 'string') {
      const tokens = html.match(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g);
      if (tokens && tokens.length > 0) {
        return tokens[0];
      }
    }
    return null;
  }

  /**
   * Strategy 1: Headless Playwright Browser Capture
   */
  private async tryPlaywrightAutoAuth(): Promise<string | null> {
    this.logger.log('Spinning up temporary Playwright headless browser instance...');
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    let interceptedToken: string | null = null;

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      });
      const page = await context.newPage();

      // Intercept WebSocket creation or HTTP requests containing token
      page.on('websocket', (ws) => {
        const url = ws.url();
        const match = url.match(/token=(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/);
        if (match && match[1]) {
          interceptedToken = match[1];
        }
      });

      page.on('request', (req) => {
        const url = req.url();
        const match = url.match(/token=(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/);
        if (match && match[1]) {
          interceptedToken = match[1];
        }
      });

      await page.goto('https://lankametro.lk/en/smartmetro', {
        waitUntil: 'networkidle',
        timeout: 25000,
      });

      // Wait briefly for WebSocket connection if needed
      for (let i = 0; i < 10; i++) {
        if (interceptedToken) break;
        await page.waitForTimeout(500);
      }
    } finally {
      await browser.close();
      this.logger.log('Playwright headless browser closed.');
    }

    return interceptedToken;
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
          this.logger.log(`JWT payload decoded. Expiration timestamp: ${expDate}`);
        }
      }
    } catch (e) {
      // If decoding fails, set default 24h expiration
      this.tokenExpiresAt = Math.floor(Date.now() / 1000) + 86400;
    }
  }
}
