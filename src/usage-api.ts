import { exec } from 'child_process';
import * as https from 'https';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type UsageLimit = {
  utilization: number;
  resets_at: string | null;
};

export type OAuthUsageResponse = {
  five_hour: UsageLimit | null;
  seven_day: UsageLimit | null;
  seven_day_sonnet: UsageLimit | null;
};

export type UsageData = {
  session: { utilization: number; resetsAt: Date | null };
  weeklyAll: { utilization: number; resetsAt: Date | null };
  weeklySonnet: { utilization: number; resetsAt: Date | null } | null;
};

export type FetchResult =
  | { status: 'success'; data: UsageData }
  | { status: 'no_token' }
  | { status: 'error'; message: string };

export function parseOAuthResponse(response: OAuthUsageResponse): UsageData {
  return {
    session: {
      utilization: response.five_hour?.utilization ?? 0,
      resetsAt: response.five_hour?.resets_at ? new Date(response.five_hour.resets_at) : null,
    },
    weeklyAll: {
      utilization: response.seven_day?.utilization ?? 0,
      resetsAt: response.seven_day?.resets_at ? new Date(response.seven_day.resets_at) : null,
    },
    weeklySonnet: response.seven_day_sonnet
      ? {
          utilization: response.seven_day_sonnet.utilization,
          resetsAt: response.seven_day_sonnet.resets_at
            ? new Date(response.seven_day_sonnet.resets_at)
            : null,
        }
      : null,
  };
}

export class UsageApiClient {
  private static readonly KEYCHAIN_SERVICE = 'Claude Code-credentials';

  async fetchUsage(): Promise<FetchResult> {
    try {
      const token = await this.getOAuthToken();
      if (!token) {
        console.log('[Clauder] No OAuth token found');
        return { status: 'no_token' };
      }

      const response = await this.callApi(token);
      return { status: 'success', data: parseOAuthResponse(response) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Clauder] API error:', error);
      return { status: 'error', message };
    }
  }

  private getOAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
      // First, try macOS keychain
      exec(
        `security find-generic-password -s "${UsageApiClient.KEYCHAIN_SERVICE}" -w`,
        (error, stdout) => {
          if (!error) {
            try {
              const creds = JSON.parse(stdout.trim());
              const token = creds?.claudeAiOauth?.accessToken;
              if (token) {
                console.log('[Clauder] Using token from macOS keychain');
                resolve(token);
                return;
              }
            } catch {
              console.log('[Clauder] Failed to parse keychain credentials');
            }
          } else {
            console.log('[Clauder] Keychain access failed:', error.message);
          }

          // Fallback: Check ANTHROPIC_API_KEY environment variable
          const envToken = process.env.ANTHROPIC_API_KEY;
          if (envToken && envToken.trim()) {
            console.log('[Clauder] Using token from ANTHROPIC_API_KEY');
            resolve(envToken.trim());
            return;
          }

          // Fallback: Try to read from ~/.claude/.credentials.json
          const credentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');

          try {
            if (fs.existsSync(credentialsPath)) {
              const credentialsContent = fs.readFileSync(credentialsPath, 'utf-8');
              const credentials = JSON.parse(credentialsContent);
              const token = credentials?.claudeAiOauth?.accessToken;

              if (token) {
                console.log('[Clauder] Using token from ~/.claude/.credentials.json');
                resolve(token);
                return;
              }
            }
          } catch (readError) {
            console.log('[Clauder] Failed to read credentials file:', readError instanceof Error ? readError.message : 'Unknown error');
          }

          console.log('[Clauder] No OAuth token found');
          resolve(null);
        }
      );
    });
  }

  private callApi(token: string): Promise<OAuthUsageResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/api/oauth/usage',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'User-Agent': 'claude-code/2.0.60',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data) as OAuthUsageResponse;
              resolve(parsed);
            } catch {
              reject(new Error('Failed to parse API response'));
            }
          });
        }
      );

      req.on('error', reject);
      req.end();
    });
  }
}
