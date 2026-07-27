import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Actor } from './types.js';
import { makeTestDb, type TestDb } from './test-support.js';
import { createMember, setMemberArchived, listMembers } from './members.js';
import { renderMembersPage } from './view-members.js';

const admin: Actor = { userId: 'admin', isAdmin: true };
const user: Actor = { userId: 'web:andy', isAdmin: false };

describe('goals members view', () => {
  let t: TestDb;

  beforeEach(() => {
    t = makeTestDb();
  });

  afterEach(() => {
    t.close();
  });

  it('lists each person with their colour and linked account', () => {
    createMember(t.db, { displayName: 'Ada', color: '#ec4899', identity: 'web:ada' });
    createMember(t.db, { displayName: 'Robin', color: '#10b981', identity: null });

    const html = renderMembersPage(listMembers(t.db), admin);

    expect(html).toContain('Ada');
    expect(html).toContain('web:ada');
    expect(html).toContain('background:#ec4899');
    expect(html).toContain('Robin');
    expect(html).toContain('No login linked');
  });

  it('separates archived people and offers to restore them', () => {
    const gone = createMember(t.db, { displayName: 'Past', color: '#7c3aed', identity: null });
    createMember(t.db, { displayName: 'Present', color: '#7c3aed', identity: null });
    setMemberArchived(t.db, gone.id, true);

    const html = renderMembersPage(listMembers(t.db), admin);

    expect(html).toContain('Archived');
    expect(html).toContain('goals-member is-archived');
    expect(html).toContain('>Restore</button>');
    expect(html).toContain('>Archive</button>');
  });

  it('offers hard delete only to an admin, and only once archived', () => {
    const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });

    expect(renderMembersPage(listMembers(t.db), admin)).not.toContain('>Delete</button>');

    setMemberArchived(t.db, member.id, true);
    expect(renderMembersPage(listMembers(t.db), admin)).toContain('>Delete</button>');
    expect(renderMembersPage(listMembers(t.db), user)).not.toContain('>Delete</button>');
  });

  it('invites the first person when the roster is empty', () => {
    const html = renderMembersPage([], admin);

    expect(html).toContain('No one here yet');
    expect(html).toContain('action="/p/goals/members/create"');
  });

  it('escapes a hostile name and identity', () => {
    createMember(t.db, {
      displayName: '"><script>alert(1)</script>',
      color: '#7c3aed',
      identity: null,
    });

    const html = renderMembersPage(listMembers(t.db), admin);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('neutralises a colour written straight into the database', () => {
    const member = createMember(t.db, { displayName: 'Ada', color: '#7c3aed', identity: null });
    t.raw
      .prepare(`UPDATE ${t.db.prefix}members SET color = ? WHERE id = ?`)
      .run('#fff;position:fixed', member.id);

    const html = renderMembersPage(listMembers(t.db), admin);

    expect(html).not.toContain('position:fixed');
    expect(html).toContain('background:#64748b');
  });
});
