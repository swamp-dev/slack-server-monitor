import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import type { Board, Comment } from './types.js';
import {
  actorFrom,
  canViewBoard,
  canEditBoardContent,
  canAdminBoard,
  canDeleteComment,
  canHardDeleteMember,
  canRelinkMember,
} from './access.js';

function board(overrides: Partial<Board> = {}): Board {
  return {
    id: 1,
    title: 'Family goals',
    description: '',
    ownerId: 'web:andy',
    visibility: 'shared',
    isDefault: false,
    archived: false,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const owner = { userId: 'web:andy', isAdmin: false };
const other = { userId: 'U999', isAdmin: false };
const admin = { userId: 'admin', isAdmin: true };

function fakeRes(locals: Record<string, unknown>): Response {
  return { locals } as unknown as Response;
}

describe('goals access', () => {
  describe('actorFrom', () => {
    it('builds an actor from res.locals', () => {
      expect(actorFrom(fakeRes({ userId: 'U123', isAdmin: true }))).toEqual({
        userId: 'U123',
        isAdmin: true,
      });
    });

    it('defaults isAdmin to false when absent', () => {
      expect(actorFrom(fakeRes({ userId: 'U123' }))).toEqual({ userId: 'U123', isAdmin: false });
    });

    it.each([
      ['a missing userId', {}],
      ['an empty userId', { userId: '' }],
      ['a whitespace userId', { userId: '   ' }],
      ['a non-string userId', { userId: 42 }],
    ])('returns null for %s', (_label, locals) => {
      expect(actorFrom(fakeRes(locals))).toBeNull();
    });

    it('returns null when locals is missing entirely', () => {
      expect(actorFrom({} as unknown as Response)).toBeNull();
    });
  });

  describe('canViewBoard', () => {
    it('lets anyone signed in see a shared board', () => {
      const shared = board({ visibility: 'shared' });
      expect(canViewBoard(shared, owner)).toBe(true);
      expect(canViewBoard(shared, other)).toBe(true);
      expect(canViewBoard(shared, admin)).toBe(true);
    });

    it('limits a private board to its owner and admins', () => {
      const priv = board({ visibility: 'private' });
      expect(canViewBoard(priv, owner)).toBe(true);
      expect(canViewBoard(priv, other)).toBe(false);
      expect(canViewBoard(priv, admin)).toBe(true);
    });
  });

  describe('canEditBoardContent', () => {
    it('matches view access — seeing the family board means you can work on it', () => {
      const shared = board({ visibility: 'shared' });
      expect(canEditBoardContent(shared, other)).toBe(true);

      const priv = board({ visibility: 'private' });
      expect(canEditBoardContent(priv, other)).toBe(false);
      expect(canEditBoardContent(priv, owner)).toBe(true);
    });
  });

  describe('canAdminBoard', () => {
    it('restricts structural changes to the owner and admins even on a shared board', () => {
      const shared = board({ visibility: 'shared' });
      expect(canAdminBoard(shared, owner)).toBe(true);
      expect(canAdminBoard(shared, other)).toBe(false);
      expect(canAdminBoard(shared, admin)).toBe(true);
    });

    it('restricts a private board the same way', () => {
      const priv = board({ visibility: 'private' });
      expect(canAdminBoard(priv, owner)).toBe(true);
      expect(canAdminBoard(priv, other)).toBe(false);
      expect(canAdminBoard(priv, admin)).toBe(true);
    });
  });

  describe('canDeleteComment', () => {
    const comment: Comment = {
      id: 1,
      cardId: 1,
      authorId: 'web:andy',
      authorMemberId: null,
      body: 'Nice',
      createdAt: 1,
    };

    it('allows the author', () => {
      expect(canDeleteComment(comment, owner)).toBe(true);
    });

    it('allows an admin', () => {
      expect(canDeleteComment(comment, admin)).toBe(true);
    });

    it('refuses anyone else', () => {
      expect(canDeleteComment(comment, other)).toBe(false);
    });
  });

  describe('canHardDeleteMember', () => {
    it('is admin-only', () => {
      expect(canHardDeleteMember(admin)).toBe(true);
      expect(canHardDeleteMember(owner)).toBe(false);
      expect(canHardDeleteMember(other)).toBe(false);
    });
  });

  describe('canRelinkMember', () => {
    it('is admin-only, because linking decides who a goal auto-assigns to', () => {
      expect(canRelinkMember(admin)).toBe(true);
      expect(canRelinkMember(owner)).toBe(false);
      expect(canRelinkMember(other)).toBe(false);
    });
  });
});
