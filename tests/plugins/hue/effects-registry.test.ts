import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEffectId,
  register,
  unregister,
  get,
  listRunning,
  stop,
  stopAll,
  _reset,
} from '../../../plugins.example/hue/effects-registry.js';

describe('effects registry', () => {
  beforeEach(() => {
    _reset();
  });

  describe('createEffectId', () => {
    it('should generate unique IDs with name prefix', () => {
      const id1 = createEffectId('flash');
      const id2 = createEffectId('flash');
      const id3 = createEffectId('pulse');

      expect(id1).toBe('flash-1');
      expect(id2).toBe('flash-2');
      expect(id3).toBe('pulse-3');
    });
  });

  describe('register / unregister / get', () => {
    it('should register and retrieve an effect', () => {
      const effect = {
        id: 'test-1',
        name: 'flash',
        targetId: 'light-1',
        abortController: new AbortController(),
        startedAt: Date.now(),
        description: 'Flash light-1',
      };
      register(effect);

      expect(get('test-1')).toBe(effect);
    });

    it('should return undefined for unknown ID', () => {
      expect(get('nonexistent')).toBeUndefined();
    });

    it('should unregister an effect', () => {
      const effect = {
        id: 'test-1',
        name: 'flash',
        targetId: 'light-1',
        abortController: new AbortController(),
        startedAt: Date.now(),
        description: 'Flash light-1',
      };
      register(effect);
      unregister('test-1');

      expect(get('test-1')).toBeUndefined();
    });
  });

  describe('listRunning', () => {
    it('should return empty array when no effects', () => {
      expect(listRunning()).toEqual([]);
    });

    it('should return all registered effects', () => {
      register({
        id: 'a',
        name: 'flash',
        targetId: 'light-1',
        abortController: new AbortController(),
        startedAt: 1000,
        description: 'A',
      });
      register({
        id: 'b',
        name: 'pulse',
        targetId: 'light-2',
        abortController: new AbortController(),
        startedAt: 2000,
        description: 'B',
      });

      const running = listRunning();
      expect(running).toHaveLength(2);
      expect(running.map((e) => e.id).sort()).toEqual(['a', 'b']);
    });
  });

  describe('stop', () => {
    it('should abort and remove an effect', () => {
      const ac = new AbortController();
      register({
        id: 'test-1',
        name: 'flash',
        targetId: 'light-1',
        abortController: ac,
        startedAt: Date.now(),
        description: 'Flash',
      });

      const result = stop('test-1');
      expect(result).toBe(true);
      expect(ac.signal.aborted).toBe(true);
      expect(get('test-1')).toBeUndefined();
    });

    it('should return false for unknown ID', () => {
      expect(stop('nonexistent')).toBe(false);
    });
  });

  describe('stopAll', () => {
    it('should abort all effects and clear registry', () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      register({
        id: 'a',
        name: 'flash',
        targetId: 'light-1',
        abortController: ac1,
        startedAt: 1000,
        description: 'A',
      });
      register({
        id: 'b',
        name: 'pulse',
        targetId: 'light-2',
        abortController: ac2,
        startedAt: 2000,
        description: 'B',
      });

      const count = stopAll();
      expect(count).toBe(2);
      expect(ac1.signal.aborted).toBe(true);
      expect(ac2.signal.aborted).toBe(true);
      expect(listRunning()).toEqual([]);
    });

    it('should return 0 when no effects', () => {
      expect(stopAll()).toBe(0);
    });
  });
});
