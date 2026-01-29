import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';

export type SoundType = 'complete' | 'warning' | 'limit';

interface SoundConfig {
  enabled: boolean;
  promptCompletion: boolean;
  rateLimitWarning: boolean;
  rateLimitHit: boolean;
  warningThreshold: number;
  customSoundPath: string;
}

const MAC_SYSTEM_SOUNDS: Record<SoundType, string> = {
  complete: '/System/Library/Sounds/Glass.aiff',
  warning: '/System/Library/Sounds/Sosumi.aiff',
  limit: '/System/Library/Sounds/Basso.aiff',
};

export class SoundPlayer {
  private extensionPath: string;
  private soundsDir: string;
  private lastPlayed: Map<string, number> = new Map();
  private readonly COOLDOWN_MS = 60_000;

  constructor(context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
    this.soundsDir = path.join(this.extensionPath, 'media', 'sounds');
  }

  private getConfig(): SoundConfig {
    const config = vscode.workspace.getConfiguration('clauder.sounds');
    return {
      enabled: config.get<boolean>('enabled', true),
      promptCompletion: config.get<boolean>('promptCompletion', true),
      rateLimitWarning: config.get<boolean>('rateLimitWarning', true),
      rateLimitHit: config.get<boolean>('rateLimitHit', true),
      warningThreshold: config.get<number>('warningThreshold', 80),
      customSoundPath: config.get<string>('customSoundPath', ''),
    };
  }

  async play(soundType: SoundType): Promise<void> {
    const config = this.getConfig();

    if (!config.enabled) return;

    if (soundType === 'complete' && !config.promptCompletion) return;
    if (soundType === 'warning' && !config.rateLimitWarning) return;
    if (soundType === 'limit' && !config.rateLimitHit) return;

    const now = Date.now();
    const lastTime = this.lastPlayed.get(soundType) || 0;
    if (now - lastTime < this.COOLDOWN_MS) return;

    let soundFile = config.customSoundPath || path.join(this.soundsDir, `${soundType}.mp3`);

    if (!fs.existsSync(soundFile)) {
      if (process.platform === 'darwin') {
        const fallback = MAC_SYSTEM_SOUNDS[soundType];
        if (fs.existsSync(fallback)) {
          soundFile = fallback;
        } else {
          console.log(`[Clauder] Sound file not found: ${soundFile}`);
          return;
        }
      } else {
        console.log(`[Clauder] Sound file not found: ${soundFile}`);
        return;
      }
    }

    try {
      await this.playFile(soundFile);
      this.lastPlayed.set(soundType, now);
    } catch (error) {
      console.log('[Clauder] Sound playback failed:', error);
    }
  }

  private playFile(soundFile: string): Promise<void> {
    return new Promise((resolve) => {
      const command = this.getPlayCommand(soundFile);
      if (!command) {
        resolve();
        return;
      }

      const [cmd, ...args] = command;
      const proc = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
      });
      proc.unref();
      resolve();
    });
  }

  private getPlayCommand(soundFile: string): string[] | null {
    const quoted = `"${soundFile}"`;

    switch (process.platform) {
      case 'darwin':
        return ['afplay', soundFile];

      case 'win32':
        return [
          'powershell',
          '-NoProfile',
          '-Command',
          `(New-Object Media.SoundPlayer '${soundFile}').PlaySync()`,
        ];

      case 'linux':
        return [
          'bash',
          '-c',
          `paplay ${quoted} 2>/dev/null || ` +
            `aplay ${quoted} 2>/dev/null || ` +
            `mpv --no-terminal ${quoted} 2>/dev/null || ` +
            `ffplay -nodisp -autoexit ${quoted} 2>/dev/null`,
        ];

      default:
        return null;
    }
  }

  checkRateLimitThreshold(utilization: number): void {
    const config = this.getConfig();

    if (utilization >= 100) {
      this.play('limit');
    } else if (utilization >= 90) {
      this.play('warning');
    } else if (utilization >= config.warningThreshold) {
      this.play('warning');
    }
  }
}
