import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
  })),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import * as vscode from 'vscode';
import { SoundPlayer, SoundType } from '~/sound-player';

const spawnMock = vi.mocked(spawn);
const existsSyncMock = vi.mocked(existsSync);

describe('SoundPlayer', () => {
  let soundPlayer: SoundPlayer;
  const mockContext = {
    extensionPath: '/test/extension',
  } as any;

  const setupConfig = (overrides: Record<string, any> = {}) => {
    const defaults: Record<string, any> = {
      enabled: true,
      promptCompletion: true,
      rateLimitWarning: true,
      rateLimitHit: true,
      warningThreshold: 80,
      customSoundPath: '',
    };
    const config = { ...defaults, ...overrides };

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, fallback: any) => {
        return key in config ? config[key] : fallback;
      }),
    } as any);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));

    spawnMock.mockClear();
    spawnMock.mockReturnValue({ unref: vi.fn() } as any);
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);

    setupConfig();

    soundPlayer = new SoundPlayer(mockContext);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('play()', () => {
    it('plays sound when enabled and file exists', async () => {
      await soundPlayer.play('complete');

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({ detached: true, stdio: 'ignore' })
      );
    });

    it('does not play when sounds are disabled globally', async () => {
      setupConfig({ enabled: false });

      await soundPlayer.play('complete');

      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('does not play complete sound when promptCompletion is disabled', async () => {
      setupConfig({ promptCompletion: false });

      await soundPlayer.play('complete');

      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('does not play warning sound when rateLimitWarning is disabled', async () => {
      setupConfig({ rateLimitWarning: false });

      await soundPlayer.play('warning');

      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('does not play limit sound when rateLimitHit is disabled', async () => {
      setupConfig({ rateLimitHit: false });

      await soundPlayer.play('limit');

      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('respects cooldown period between plays of same sound type', async () => {
      await soundPlayer.play('complete');
      expect(spawnMock).toHaveBeenCalledTimes(1);

      await soundPlayer.play('complete');
      expect(spawnMock).toHaveBeenCalledTimes(1); // Still 1, blocked by cooldown

      vi.advanceTimersByTime(30_000);
      await soundPlayer.play('complete');
      expect(spawnMock).toHaveBeenCalledTimes(1); // Still 1

      vi.advanceTimersByTime(31_000);
      await soundPlayer.play('complete');
      expect(spawnMock).toHaveBeenCalledTimes(2); // Now 2
    });

    it('allows different sound types to play independently', async () => {
      await soundPlayer.play('complete');
      expect(spawnMock).toHaveBeenCalledTimes(1);

      await soundPlayer.play('warning');
      expect(spawnMock).toHaveBeenCalledTimes(2);

      await soundPlayer.play('limit');
      expect(spawnMock).toHaveBeenCalledTimes(3);
    });

    it('does not play when sound file does not exist (non-darwin)', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });

      existsSyncMock.mockReturnValue(false);

      await soundPlayer.play('complete');

      expect(spawnMock).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('uses custom sound path when configured', async () => {
      const customPath = '/custom/sound.mp3';
      setupConfig({ customSoundPath: customPath });

      await soundPlayer.play('complete');

      expect(existsSyncMock).toHaveBeenCalledWith(customPath);
      expect(spawnMock).toHaveBeenCalled();
    });

    it('falls back to macOS system sounds when bundled sound missing on darwin', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      existsSyncMock
        .mockReturnValueOnce(false) // bundled sound doesn't exist
        .mockReturnValueOnce(true); // system sound exists

      await soundPlayer.play('complete');

      expect(spawnMock).toHaveBeenCalled();
      expect(existsSyncMock).toHaveBeenCalledWith('/System/Library/Sounds/Glass.aiff');

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('checkRateLimitThreshold()', () => {
    it('plays limit sound when utilization >= 100', async () => {
      await soundPlayer.checkRateLimitThreshold(100);

      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('plays limit sound when utilization > 100', async () => {
      await soundPlayer.checkRateLimitThreshold(105);

      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('plays warning sound when utilization >= 90 and < 100', async () => {
      await soundPlayer.checkRateLimitThreshold(90);

      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('plays warning sound when utilization >= warningThreshold (default 80)', async () => {
      await soundPlayer.checkRateLimitThreshold(80);

      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('uses custom warningThreshold from config', async () => {
      setupConfig({ warningThreshold: 70 });

      await soundPlayer.checkRateLimitThreshold(70);

      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('does not play sound when utilization is below threshold', async () => {
      await soundPlayer.checkRateLimitThreshold(79);

      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('does not play sound when utilization is 0', async () => {
      await soundPlayer.checkRateLimitThreshold(0);

      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('prioritizes limit sound over warning at 100%', async () => {
      await soundPlayer.checkRateLimitThreshold(100);
      vi.advanceTimersByTime(61_000);
      await soundPlayer.checkRateLimitThreshold(99);

      expect(spawnMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPlayCommand() platform handling', () => {
    const testPlatforms = [
      { platform: 'darwin', expectedCmd: 'afplay' },
      { platform: 'win32', expectedCmd: 'powershell' },
      { platform: 'linux', expectedCmd: 'bash' },
    ];

    testPlatforms.forEach(({ platform, expectedCmd }) => {
      it(`uses ${expectedCmd} on ${platform}`, async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: platform });

        await soundPlayer.play('complete');

        expect(spawnMock).toHaveBeenCalledWith(
          expectedCmd,
          expect.any(Array),
          expect.any(Object)
        );

        Object.defineProperty(process, 'platform', { value: originalPlatform });
      });
    });

    it('returns null for unsupported platforms', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'freebsd' });

      await soundPlayer.play('complete');

      expect(spawnMock).not.toHaveBeenCalled();

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });

  describe('macOS system sound fallbacks', () => {
    const fallbackTests: Array<{ soundType: SoundType; expectedFallback: string }> = [
      { soundType: 'complete', expectedFallback: '/System/Library/Sounds/Glass.aiff' },
      { soundType: 'warning', expectedFallback: '/System/Library/Sounds/Sosumi.aiff' },
      { soundType: 'limit', expectedFallback: '/System/Library/Sounds/Basso.aiff' },
    ];

    fallbackTests.forEach(({ soundType, expectedFallback }) => {
      it(`falls back to ${expectedFallback} for ${soundType} sound on macOS`, async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'darwin' });

        existsSyncMock
          .mockReturnValueOnce(false) // bundled sound doesn't exist
          .mockReturnValueOnce(true); // system sound exists

        await soundPlayer.play(soundType);

        expect(existsSyncMock).toHaveBeenCalledWith(expectedFallback);

        Object.defineProperty(process, 'platform', { value: originalPlatform });
      });
    });
  });

  describe('error handling', () => {
    it('handles spawn errors gracefully', async () => {
      spawnMock.mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await expect(soundPlayer.play('complete')).resolves.not.toThrow();
    });

    it('does not update lastPlayed timestamp on error', async () => {
      spawnMock.mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });

      await soundPlayer.play('complete');
      spawnMock.mockReturnValue({ unref: vi.fn() } as any);
      await soundPlayer.play('complete');

      expect(spawnMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration edge cases', () => {
    it('handles empty customSoundPath as falsy', async () => {
      setupConfig({ customSoundPath: '' });
      await soundPlayer.play('complete');

      expect(existsSyncMock).toHaveBeenCalledWith('/test/extension/media/sounds/complete.mp3');
    });

    it('handles warningThreshold at minimum boundary (50)', async () => {
      setupConfig({ warningThreshold: 50 });

      await soundPlayer.checkRateLimitThreshold(49);
      expect(spawnMock).not.toHaveBeenCalled();

      await soundPlayer.checkRateLimitThreshold(50);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('always plays warning at 90%+ regardless of warningThreshold', async () => {
      setupConfig({ warningThreshold: 99 });

      await soundPlayer.checkRateLimitThreshold(89);
      expect(spawnMock).not.toHaveBeenCalled();

      await soundPlayer.checkRateLimitThreshold(90);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
  });
});
