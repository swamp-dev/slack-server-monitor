/**
 * Factory for consistent store singleton behaviour across all store files.
 *
 * All stores must enforce the same invariant: a second call with a *different*
 * dbPath is a programming error (two parts of the app disagree on where the
 * database lives). Previously half the stores enforced this strictly and the
 * other half silently reused the first path — this factory makes the strict
 * behaviour the only behaviour.
 */

export interface StoreSingleton<T extends { close(): void }> {
  /** Return the existing instance, or create it with `factory` on first call. */
  get(dbPath: string, factory: () => T): T;
  /** Close the store and clear state. No-op if not initialized. */
  close(): void;
  /** Clear state WITHOUT calling close(). For use in test teardown only. */
  _resetForTests(): void;
}

export function createStoreSingleton<T extends { close(): void }>(storeName: string): StoreSingleton<T> {
  let instance: T | null = null;
  let instancePath: string | null = null;

  return {
    get(dbPath: string, factory: () => T): T {
      if (instance !== null && instancePath !== dbPath) {
        throw new Error(
          `${storeName} already initialized at ${instancePath ?? '<unknown>'} — ` +
            `cannot re-initialize at ${dbPath}. Call close() first.`,
        );
      }
      if (instance === null) {
        instance = factory();
        instancePath = dbPath;
      }
      return instance;
    },

    close(): void {
      if (instance !== null) {
        instance.close();
        instance = null;
        instancePath = null;
      }
    },

    _resetForTests(): void {
      instance = null;
      instancePath = null;
    },
  };
}
