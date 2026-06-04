import { describe, it, expect, beforeEach } from 'vitest';
import { createStoreSingleton } from '../../src/services/store-factory.js';

class MockStore {
  readonly dbPath: string;
  closeCalled = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  close(): void {
    this.closeCalled = true;
  }
}

describe('createStoreSingleton', () => {
  let singleton: ReturnType<typeof createStoreSingleton<MockStore>>;

  beforeEach(() => {
    singleton = createStoreSingleton<MockStore>('MockStore');
  });

  it('returns the same instance when called twice with the same path', () => {
    const a = singleton.get('/db/a.db', () => new MockStore('/db/a.db'));
    const b = singleton.get('/db/a.db', () => new MockStore('/db/a.db'));
    expect(a).toBe(b);
  });

  it('does not call the factory function on the second same-path call', () => {
    let factoryCalls = 0;
    const factory = () => {
      factoryCalls++;
      return new MockStore('/db/a.db');
    };
    singleton.get('/db/a.db', factory);
    singleton.get('/db/a.db', factory);
    expect(factoryCalls).toBe(1);
  });

  it('throws when called with a different path after initialization', () => {
    singleton.get('/old.db', () => new MockStore('/old.db'));
    expect(() => singleton.get('/new.db', () => new MockStore('/new.db'))).toThrow(Error);
  });

  it('error message identifies store name, old path, and new path', () => {
    singleton.get('/old.db', () => new MockStore('/old.db'));
    expect(() => singleton.get('/new.db', () => new MockStore('/new.db'))).toThrow(
      /MockStore.*\/old\.db.*\/new\.db/,
    );
  });

  it('close() calls the store close() method and clears state', () => {
    const store = singleton.get('/db.db', () => new MockStore('/db.db'));
    singleton.close();
    expect(store.closeCalled).toBe(true);
  });

  it('close() allows re-initialization at a new path after closing', () => {
    singleton.get('/first.db', () => new MockStore('/first.db'));
    singleton.close();
    const second = singleton.get('/second.db', () => new MockStore('/second.db'));
    expect(second.dbPath).toBe('/second.db');
  });

  it('close() is a no-op when the singleton has not been initialized', () => {
    expect(() => singleton.close()).not.toThrow();
  });

  it('_resetForTests() allows re-initialization without calling close on the store', () => {
    const store = singleton.get('/db.db', () => new MockStore('/db.db'));
    singleton._resetForTests();
    expect(store.closeCalled).toBe(false);
  });

  it('_resetForTests() allows a new path after reset', () => {
    singleton.get('/old.db', () => new MockStore('/old.db'));
    singleton._resetForTests();
    const store = singleton.get('/new.db', () => new MockStore('/new.db'));
    expect(store.dbPath).toBe('/new.db');
  });
});
