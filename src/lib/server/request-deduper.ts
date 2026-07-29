import "server-only";

const pending = new Map<string, Promise<unknown>>();

export function dedupeRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const promise = request().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

