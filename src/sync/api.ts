import * as https from 'https';
import { SyncPayload, SyncResponse, SyncResult } from './types';

/**
 * API client for syncing usage data to the Clauder backend
 */
export class SyncApiClient {
  private backendUrl: string;
  private userAgent = 'Clauder-VSCode-Extension';

  constructor(backendUrl: string) {
    this.backendUrl = backendUrl;
  }

  /**
   * Sync usage data to the backend
   */
  async sync(payload: SyncPayload): Promise<SyncResult> {
    if (!payload.license_key) {
      return { status: 'error', error: 'No license key provided' };
    }

    try {
      const response = await this.postSync(payload);
      return { status: 'success', data: response };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 'error', error: message };
    }
  }

  private postSync(payload: SyncPayload): Promise<SyncResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/sync', this.backendUrl);
      const data = JSON.stringify(payload);

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': this.userAgent,
        },
      };

      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              const parsed = JSON.parse(body) as SyncResponse;
              resolve(parsed);
            } catch {
              reject(new Error('Invalid JSON response from server'));
            }
          } else if (res.statusCode === 401) {
            reject(new Error('Invalid license key'));
          } else if (res.statusCode === 429) {
            reject(new Error('Rate limited - too many sync requests'));
          } else {
            reject(new Error(`Server returned ${res.statusCode}: ${body}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Update the backend URL
   */
  setBackendUrl(url: string): void {
    this.backendUrl = url;
  }
}
