import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GoalsError } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import {
  listMembers,
  getMember,
  createMember,
  updateMember,
  setMemberArchived,
  hardDeleteMember,
  findMemberByIdentity,
  countMemberReferences,
} from './members.js';
import { createBoard } from './boards.js';
import { createColumn } from './columns.js';
import { createCard } from './cards.js';

describe('goals members', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });

  afterEach(() => {
    t.close();
  });

  describe('createMember', () => {
    it('stores the member and returns it', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      expect(member.id).toBeGreaterThan(0);
      expect(member.displayName).toBe('Ada');
      expect(member.color).toBe('#7c3aed');
      expect(member.identity).toBeNull();
      expect(member.archived).toBe(false);
    });

    it('allows several members with no linked identity', () => {
      createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      expect(() =>
        createMember(t.db, { displayName: 'Bea', color: '#06b6d4', identity: null })
      ).not.toThrow();
    });

    it('refuses a duplicate identity with IDENTITY_TAKEN', () => {
      createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: 'U123' });

      try {
        createMember(t.db, { displayName: 'Bea', color: '#06b6d4', identity: 'U123' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect(err).toBeInstanceOf(GoalsError);
        expect((err as GoalsError).code).toBe('IDENTITY_TAKEN');
      }
    });
  });

  describe('listMembers', () => {
    it('sorts active members by name and puts archived ones last', () => {
      const zoe = createMember(t.db, { displayName: 'Zoe', color: '#7c3aed', identity: null });
      const ada = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      const old = createMember(t.db, { displayName: 'Abe', color: '#7c3aed', identity: null });
      setMemberArchived(t.db, old.id, true);

      expect(listMembers(t.db).map((m) => m.displayName)).toEqual(['Ada', 'Zoe', 'Abe']);
      expect(listMembers(t.db, { includeArchived: false }).map((m) => m.id)).toEqual([
        ada.id,
        zoe.id,
      ]);
    });

    it('sorts case-insensitively', () => {
      createMember(t.db, { displayName: 'bea', color: '#7c3aed', identity: null });
      createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      expect(listMembers(t.db).map((m) => m.displayName)).toEqual(['Ada', 'bea']);
    });
  });

  describe('getMember and findMemberByIdentity', () => {
    it('finds by id and by identity', () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });

      expect(getMember(t.db, member.id)?.displayName).toBe('Ada');
      expect(findMemberByIdentity(t.db, 'web:ada')?.id).toBe(member.id);
    });

    it('returns null for a miss', () => {
      expect(getMember(t.db, 999)).toBeNull();
      expect(findMemberByIdentity(t.db, 'U404')).toBeNull();
      expect(findMemberByIdentity(t.db, '')).toBeNull();
    });

    it('ignores archived members when resolving an identity', () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'web:ada',
      });
      setMemberArchived(t.db, member.id, true);

      expect(findMemberByIdentity(t.db, 'web:ada')).toBeNull();
    });
  });

  describe('updateMember', () => {
    it('applies only the fields provided', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      const updated = updateMember(t.db, member.id, { displayName: 'Ada L' });

      expect(updated.displayName).toBe('Ada L');
      expect(updated.color).toBe('#7c3aed');
    });

    it('can unlink an identity', () => {
      const member = createMember(t.db, {
        displayName: 'Ada',
        color: '#7c3aed',
        identity: 'U123',
      });

      expect(updateMember(t.db, member.id, { identity: null }).identity).toBeNull();
    });

    it('refuses to take an identity another member holds', () => {
      createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: 'U123' });
      const bea = createMember(t.db, { displayName: 'Bea', color: '#06b6d4', identity: null });

      expect(() => updateMember(t.db, bea.id, { identity: 'U123' })).toThrow(GoalsError);
    });

    it('throws NOT_FOUND for an unknown member', () => {
      try {
        updateMember(t.db, 999, { displayName: 'Ghost' });
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('hardDeleteMember', () => {
    function assignedMember() {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
      const board = createBoard(t.db, { title: 'B', ownerId: 'admin' });
      const column = createColumn(t.db, { boardId: board.id, name: 'Todo' });
      createCard(t.db, {
        columnId: column.id,
        title: 'Card',
        createdBy: 'admin',
        assigneeId: member.id,
      });
      return member;
    }

    it('refuses while the member is assigned to a card', () => {
      const member = assignedMember();

      try {
        hardDeleteMember(t.db, member.id);
        expect.unreachable('expected a GoalsError');
      } catch (err) {
        expect((err as GoalsError).code).toBe('IN_USE');
      }
    });

    it('reports why it refused', () => {
      const member = assignedMember();
      expect(countMemberReferences(t.db, member.id)).toEqual({ cards: 1, comments: 0 });
    });

    it('deletes an unreferenced member', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      hardDeleteMember(t.db, member.id);

      expect(getMember(t.db, member.id)).toBeNull();
    });
  });

  describe('setMemberArchived', () => {
    it('keeps the member and their assignments intact', () => {
      const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

      setMemberArchived(t.db, member.id, true);
      expect(getMember(t.db, member.id)?.archived).toBe(true);

      setMemberArchived(t.db, member.id, false);
      expect(getMember(t.db, member.id)?.archived).toBe(false);
    });
  });
});
