export class ConfigCache<T> {
  private cache: { value: T; timestamp: number } | null = null;

  constructor(
    private readonly fetcher: () => T,
    private readonly ttl: number = 10_000
  ) {}

  get(): T {
    const now = Date.now();
    if (!this.cache || now - this.cache.timestamp > this.ttl) {
      this.cache = { value: this.fetcher(), timestamp: now };
    }
    return this.cache.value;
  }

  invalidate(): void {
    this.cache = null;
  }
}
