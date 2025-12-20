# Clauder

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/nrentas.clauder)](https://marketplace.visualstudio.com/items?itemName=nrentas.clauder)
[![VS Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/nrentas.clauder)](https://marketplace.visualstudio.com/items?itemName=nrentas.clauder)
[![Open VSX](https://img.shields.io/open-vsx/dt/nrentas/clauder)](https://open-vsx.org/extension/nrentas/clauder)
[![codecov](https://codecov.io/gh/nksrentas/clauder/graph/badge.svg)](https://codecov.io/gh/nksrentas/clauder)

A VS Code extension that displays your Claude Code usage in the status bar. Monitor your 5-hour session and weekly limits at a glance.

![Demo](images/clauder-demo.gif)

## Features

**Status Bar Display**
- Shows your current 5-hour session usage with time until reset
- Color-coded indicator that shifts from tan to red as usage increases
- Automatically shows weekly usage when approaching your weekly limit

**Limit Detection**
- Alerts you when you hit the 5-hour or weekly limit
- Automatically pauses polling and resumes when your limit resets

**Detailed Tooltip**
- Weekly usage for all models with reset day/time
- Weekly Sonnet-only usage (if applicable)
- Model breakdown with token counts and estimated costs

## Requirements

- macOS (uses Keychain for OAuth credentials)
- Claude Code CLI installed and authenticated (`claude` command)

## Installation

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=nrentas.clauder) or search for "Clauder" in VS Code Extensions.

## How It Works

The extension reads your OAuth token from macOS Keychain (stored by Claude Code CLI) and fetches usage data from Anthropic's API.

**Status bar examples:**

```
61% | 2h 15m              Normal usage
61% | 2h 15m · W 92% | Sun 22   Weekly usage highlighted (>90%)
5h limit reached | 45m    Limit hit, shows time until reset
```

**Hover for details:**

Hover over the status bar item to see a breakdown of your weekly usage across all models, Sonnet-specific limits, and estimated costs.

## Configuration

| Setting                            | Default | Description                                              |
| ---------------------------------- | ------- | -------------------------------------------------------- |
| `clauder.plan`                     | `pro`   | Your subscription plan: `pro`, `max5`, or `max20`        |
| `clauder.refreshInterval`          | `30`    | Auto-refresh interval in seconds (5-300)                 |
| `clauder.weeklyHighlightThreshold` | `90`    | Show weekly usage in status bar when above this % (50-100) |

## Commands

- **Clauder: Refresh** - Manually refresh usage data (or click the status bar)

## Troubleshooting

**"Not authenticated" message**

Run `claude` in your terminal and complete the authentication flow. The extension reads credentials from the same Keychain entry used by Claude Code CLI.

**Usage data not updating**

Click the status bar item or run "Clauder: Refresh" from the Command Palette.

## License

MIT
