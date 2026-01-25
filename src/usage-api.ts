import { exec } from 'child_process';
import * as https from 'https';

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
      const command = this.getKeychainCommand();
      if (!command) {
        console.log('[Clauder] Unsupported platform:', process.platform);
        resolve(null);
        return;
      }

      exec(command, (error, stdout) => {
        if (error) {
          console.log('[Clauder] Keychain access failed:', error.message);
          resolve(null);
          return;
        }

        try {
          const creds = JSON.parse(stdout.trim());
          const token = creds?.claudeAiOauth?.accessToken;
          resolve(token || null);
        } catch {
          console.log('[Clauder] Failed to parse credentials');
          resolve(null);
        }
      });
    });
  }

  private getKeychainCommand(): string | null {
    const service = UsageApiClient.KEYCHAIN_SERVICE;

    switch (process.platform) {
      case 'darwin':
        return `security find-generic-password -s "${service}" -w`;
      case 'win32':
        // PowerShell command to read from Windows Credential Manager using CredRead API
        return `powershell -Command "$cred = Get-StoredCredential -Target '${service}' -AsCredentialObject; if ($cred) { $cred.Password } else { exit 1 }"`;
      case 'linux':
        return `secret-tool lookup service "${service}"`;
      default:
        return null;
    }
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
