function formatDurationMs(
  ms: number,
  options: { prefix?: string; alwaysShowMinutes?: boolean } = {}
): string {
  const { prefix = '', alwaysShowMinutes = false } = options;

  if (ms <= 0) {
    return 'now';
  }

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${prefix}${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    if (alwaysShowMinutes || minutes > 0) {
      return `${prefix}${hours}h ${minutes}m`;
    }
    return `${prefix}${hours}h`;
  }

  return `${prefix}${minutes}m`;
}

export function formatTimeRemaining(endTime: Date, now: Date = new Date()): string {
  return formatDurationMs(endTime.getTime() - now.getTime(), { alwaysShowMinutes: true });
}

export function formatResetDay(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const day = days[date.getDay()];
  const dayOfMonth = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  const minuteStr = minutes.toString().padStart(2, '0');
  return `${day} ${dayOfMonth} ${hour12}:${minuteStr} ${ampm}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return tokens.toString();
}

export function getUsageColor(percentage: number): string | undefined {
  if (percentage >= 90) {
    return '#D4634B';
  }
  if (percentage >= 80) {
    return '#E07B53';
  }
  if (percentage >= 60) {
    return '#E8956A';
  }
  if (percentage >= 40) {
    return '#F0B090';
  }
  return '#D4A27C';
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatPredictionTime(ms: number | null): string {
  if (ms === null) return 'unknown';
  return formatDurationMs(ms, { prefix: '~' });
}

export function formatRate(tokensPerHour: number): string {
  if (tokensPerHour >= 1_000_000) {
    return `${(tokensPerHour / 1_000_000).toFixed(1)}M tokens/hr`;
  }
  if (tokensPerHour >= 1000) {
    return `${Math.round(tokensPerHour / 1000)}K tokens/hr`;
  }
  return `${tokensPerHour} tokens/hr`;
}
