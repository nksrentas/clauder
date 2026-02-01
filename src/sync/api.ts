import * as http from 'http';
import * as https from 'https';
import { PredictionResponse, PredictionResult, SyncPayload, SyncResponse, SyncResult } from './types';

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
   * Get the appropriate request module based on URL protocol
   */
  private getRequestModule(url: URL): typeof http | typeof https {
    return url.protocol === 'https:' ? https : http;
  }

  /**
   * Get the default port based on URL protocol
   */
  private getDefaultPort(url: URL): number {
    return url.protocol === 'https:' ? 443 : 80;
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
      const requestModule = this.getRequestModule(url);

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || this.getDefaultPort(url),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'User-Agent': this.userAgent,
        },
      };

      const req = requestModule.request(options, (res) => {
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
   * Fetch prediction data from the backend
   */
  async fetchPrediction(licenseKey: string): Promise<PredictionResult> {
    if (!licenseKey) {
      return { status: 'disabled' };
    }

    try {
      const response = await this.getPrediction(licenseKey);
      return { status: 'success', data: response };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { status: 'error', error: message };
    }
  }

  private getPrediction(licenseKey: string): Promise<PredictionResponse> {
    return new Promise((resolve, reject) => {
      const url = new URL('/api/predict', this.backendUrl);
      url.searchParams.set('license_key', licenseKey);
      const requestModule = this.getRequestModule(url);

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || this.getDefaultPort(url),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          'User-Agent': this.userAgent,
        },
      };

      const req = requestModule.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body) as PredictionResponse;
              resolve(parsed);
            } catch {
              reject(new Error('Invalid JSON response from prediction endpoint'));
            }
          } else if (res.statusCode === 401) {
            reject(new Error('Invalid license key'));
          } else if (res.statusCode === 429) {
            reject(new Error('Rate limited'));
          } else if (res.statusCode === 404) {
            reject(new Error('No prediction data available yet'));
          } else {
            reject(new Error(`Prediction failed: ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Network error: ${error.message}`));
      });

      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Prediction request timed out'));
      });

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
