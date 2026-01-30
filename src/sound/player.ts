import * as vscode from 'vscode';

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PLATFORM, SOUND_EXECUTABLE, SOUND_TYPE } from '~/types';

export type SoundType = (typeof SOUND_TYPE)[keyof typeof SOUND_TYPE];

interface SoundConfig {
  enabled: boolean;
  promptCompletion: boolean;
  rateLimitWarning: boolean;
  rateLimitHit: boolean;
  warningThreshold: number;
  customSoundPath: string;
}

const MAC_SYSTEM_SOUNDS: Record<SoundType, string> = {
  [SOUND_TYPE.COMPLETE]: '/System/Library/Sounds/Glass.aiff',
  [SOUND_TYPE.WARNING]: '/System/Library/Sounds/Sosumi.aiff',
  [SOUND_TYPE.LIMIT]: '/System/Library/Sounds/Basso.aiff',
};

const UNSAFE_PATH_CHARS = /['"`$\\;\|\n\r\0&><(){}[\]!#~]/;

export class SoundPlayer {
  private extensionPath: string;
  private soundsDir: string;
  private lastPlayed: Map<string, number> = new Map();
  private readonly COOLDOWN_MS = 60_000;
  private lastWarnedLevel: 'none' | 'warning' | 'limit' = 'none';

  private configCache: { config: SoundConfig; timestamp: number } | null = null;
  private readonly CONFIG_TTL = 10_000;

  constructor(context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
    this.soundsDir = path.join(this.extensionPath, 'media', 'sounds');
  }

  invalidateConfigCache(): void {
    this.configCache = null;
  }

  private getConfig(): SoundConfig {
    const now = Date.now();
    if (this.configCache && now - this.configCache.timestamp <= this.CONFIG_TTL) {
      return this.configCache.config;
    }

    const config = vscode.workspace.getConfiguration('clauder.sounds');
    const soundConfig: SoundConfig = {
      enabled: config.get<boolean>('enabled', true),
      promptCompletion: config.get<boolean>('promptCompletion', true),
      rateLimitWarning: config.get<boolean>('rateLimitWarning', true),
      rateLimitHit: config.get<boolean>('rateLimitHit', true),
      warningThreshold: config.get<number>('warningThreshold', 80),
      customSoundPath: config.get<string>('customSoundPath', ''),
    };

    this.configCache = { config: soundConfig, timestamp: now };
    return soundConfig;
  }

  async play(soundType: SoundType): Promise<void> {
    const config = this.getConfig();

    if (!config.enabled) return;

    if (soundType === SOUND_TYPE.COMPLETE && !config.promptCompletion) return;
    if (soundType === SOUND_TYPE.WARNING && !config.rateLimitWarning) return;
    if (soundType === SOUND_TYPE.LIMIT && !config.rateLimitHit) return;

    const now = Date.now();
    const lastTime = this.lastPlayed.get(soundType) || 0;
    if (now - lastTime < this.COOLDOWN_MS) return;

    let soundFile = config.customSoundPath || path.join(this.soundsDir, `${soundType}.mp3`);

    if (!fs.existsSync(soundFile)) {
      if (process.platform === PLATFORM.DARWIN) {
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

  private isSafePath(filePath: string): boolean {
    if (process.platform === PLATFORM.DARWIN) {
      return true;
    }
    return !UNSAFE_PATH_CHARS.test(filePath);
  }

  private playFile(soundFile: string): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isSafePath(soundFile)) {
        console.log('[Clauder] Sound path contains unsafe characters, skipping playback');
        resolve();
        return;
      }

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
      case PLATFORM.DARWIN:
        return [SOUND_EXECUTABLE.AFPLAY, soundFile];

      case PLATFORM.WIN32:
        return [
          SOUND_EXECUTABLE.POWERSHELL,
          '-NoProfile',
          '-Command',
          `(New-Object Media.SoundPlayer '${soundFile}').PlaySync()`,
        ];

      case PLATFORM.LINUX:
        return [
          SOUND_EXECUTABLE.BASH,
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
      if (this.lastWarnedLevel !== 'limit') {
        this.play(SOUND_TYPE.LIMIT);
        this.lastWarnedLevel = 'limit';
      }
    } else if (utilization >= 90 || utilization >= config.warningThreshold) {
      if (this.lastWarnedLevel === 'none') {
        this.play(SOUND_TYPE.WARNING);
        this.lastWarnedLevel = 'warning';
      }
    } else {
      this.lastWarnedLevel = 'none';
    }
  }

  resetThresholdState(): void {
    this.lastWarnedLevel = 'none';
  }
}
