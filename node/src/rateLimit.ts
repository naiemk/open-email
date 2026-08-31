export function createHitWindow() {
  const hits = new Map<string, number[]>();
  return {
    take(name: string, now: number, hourMax: number, dayMax: number): boolean {
      const dayAgo = now - 86_400_000;
      const hourAgo = now - 3_600_000;
      const day = (hits.get(name) ?? []).filter((t) => t > dayAgo);
      const hour = day.filter((t) => t > hourAgo);
      if (hour.length >= hourMax || day.length >= dayMax) {
        hits.set(name, day);
        return false;
      }
      day.push(now);
      hits.set(name, day);
      return true;
    },
  };
}
