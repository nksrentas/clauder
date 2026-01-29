# Sound Files

This directory contains sound files for Clauder notifications.

## Required Files

| File | Purpose |
|------|---------|
| `complete.mp3` | Played when Claude Code finishes responding |
| `warning.mp3` | Played when approaching rate limits (80%, 90%) |
| `limit.mp3` | Played when rate limit is reached (100%) |

## Notes

- Sound files should be short (under 2 seconds)
- MP3 format is recommended for cross-platform compatibility
- If files are missing, sounds will be silently skipped
- Users can specify custom sound paths in VS Code settings
