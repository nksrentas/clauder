import { exec } from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';

import { FETCH_STATUS, KEYCHAIN_SERVICE, PLATFORM } from '~/types';
import type { BillingMode } from '~/types';

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
  | { status: typeof FETCH_STATUS.SUCCESS; data: UsageData }
  | { status: typeof FETCH_STATUS.NO_TOKEN }
  | { status: typeof FETCH_STATUS.ERROR; message: string };

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
  async fetchUsage(): Promise<FetchResult> {
    try {
      const token = await this.getOAuthToken();
      if (!token) {
        console.log('[Clauder] No OAuth token found');
        return { status: FETCH_STATUS.NO_TOKEN };
      }

      const response = await this.callApi(token);
      return { status: FETCH_STATUS.SUCCESS, data: parseOAuthResponse(response) };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Clauder] API error:', error);
      return { status: FETCH_STATUS.ERROR, message };
    }
  }

  private getOAuthToken(): Promise<string | null> {
    return new Promise((resolve) => {
      const command = this.getKeychainCommand();
      if (!command) {
        this.tryFallbacks(resolve);
        return;
      }

      exec(command, (error, stdout) => {
        if (!error) {
          try {
            const creds = JSON.parse(stdout.trim());
            const token = creds?.claudeAiOauth?.accessToken;
            if (token) {
              console.log('[Clauder] Using token from system keychain');
              resolve(token);
              return;
            }
          } catch {
            console.log('[Clauder] Failed to parse keychain credentials');
          }
        } else {
          console.log('[Clauder] Keychain access failed:', error.message);
        }

        this.tryFallbacks(resolve);
      });
    });
  }

  private tryFallbacks(resolve: (token: string | null) => void): void {
    const envToken = process.env.CLAUDE_CODE_API_KEY;
    if (envToken && envToken.trim()) {
      console.log('[Clauder] Using token from CLAUDE_CODE_API_KEY');
      resolve(envToken.trim());
      return;
    }

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
      console.log(
        '[Clauder] Failed to read credentials file:',
        readError instanceof Error ? readError.message : 'Unknown error'
      );
    }

    console.log('[Clauder] No OAuth token found');
    resolve(null);
  }

  private getKeychainCommand(): string | null {
    switch (process.platform) {
      case PLATFORM.DARWIN:
        return `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`;
      case PLATFORM.WIN32:
        return `powershell -Command "$cred = Get-StoredCredential -Target '${KEYCHAIN_SERVICE}' -AsCredentialObject; if ($cred) { $cred.Password } else { exit 1 }"`;
      case PLATFORM.LINUX:
        return `secret-tool lookup service "${KEYCHAIN_SERVICE}"`;
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
          res.on('error', reject);
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`API request failed with status ${res.statusCode}`));
              return;
            }
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

  /**
   * Detect billing mode: subscription (OAuth/rate limits) vs api_key (pay-per-token)
   */
  async detectBillingMode(): Promise<{ mode: BillingMode; apiKeyPrefix?: string }> {
    // First, try OAuth token - if it works, user is on subscription
    const token = await this.getOAuthToken();
    if (token) {
      try {
        await this.callApi(token);
        console.log('[Clauder] Billing mode: subscription (OAuth token works)');
        return { mode: 'subscription' };
      } catch {
        // OAuth token didn't work, continue to check API key
        console.log('[Clauder] OAuth token found but API failed, checking for API key');
      }
    }

    // Check for Anthropic API key
    const apiKeyResult = this.getAnthropicApiKey();
    if (apiKeyResult) {
      console.log('[Clauder] Billing mode: api_key');
      return { mode: 'api_key', apiKeyPrefix: apiKeyResult.prefix };
    }

    console.log('[Clauder] Billing mode: unknown');
    return { mode: 'unknown' };
  }

  /**
   * Get Anthropic API key from environment or config file
   * Returns the key and a prefix for display
   */
  private getAnthropicApiKey(): { key: string; prefix: string } | null {
    // Check environment variable
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey && envKey.trim()) {
      const key = envKey.trim();
      return { key, prefix: this.getKeyPrefix(key) };
    }

    // Check ~/.anthropic/api_key file
    const apiKeyPath = path.join(os.homedir(), '.anthropic', 'api_key');
    try {
      if (fs.existsSync(apiKeyPath)) {
        const key = fs.readFileSync(apiKeyPath, 'utf-8').trim();
        if (key) {
          return { key, prefix: this.getKeyPrefix(key) };
        }
      }
    } catch {
      // Ignore read errors
    }

    // Check Claude config for API key
    const claudeConfigPath = path.join(os.homedir(), '.claude', 'config.json');
    try {
      if (fs.existsSync(claudeConfigPath)) {
        const config = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
        const key = config?.apiKey || config?.anthropicApiKey;
        if (key) {
          return { key, prefix: this.getKeyPrefix(key) };
        }
      }
    } catch {
      // Ignore read errors
    }

    return null;
  }

  /**
   * Get a safe prefix of the API key for display (first 12 chars + ...)
   */
  private getKeyPrefix(key: string): string {
    if (key.length <= 12) return key;
    return key.slice(0, 12) + '...';
  }
}
