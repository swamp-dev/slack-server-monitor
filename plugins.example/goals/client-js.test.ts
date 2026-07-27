import { describe, it, expect } from 'vitest';
import { boardClientJs, INDEX_CLIENT_JS, MEMBERS_CLIENT_JS } from './client-js.js';

describe('goals client script', () => {
  const script = boardClientJs(7);

  it('is a self-contained script element', () => {
    expect(script.startsWith('<script>')).toBe(true);
    expect(script.endsWith('</script>')).toBe(true);
  });

  it('cannot break out of its script element', () => {
    // A literal </script> inside a JS string would close the tag early.
    const body = script.slice('<script>'.length, -'</script>'.length);
    expect(body).not.toContain('</script');
  });

  it('embeds the board id and nothing else that varies', () => {
    expect(script).toContain('var BOARD_ID = 7;');

    const other = boardClientJs(999);
    expect(other).toContain('var BOARD_ID = 999;');
    expect(other.replace('var BOARD_ID = 999;', 'X')).toBe(script.replace('var BOARD_ID = 7;', 'X'));
  });

  it('has no unresolved template interpolation', () => {
    // The script lives inside TS template literals; a stray ${ would have been
    // evaluated at build time or, worse, shipped verbatim.
    expect(script).not.toContain('${');
  });

  describe('drag', () => {
    it('uses pointer events with capture, not HTML5 drag-and-drop', () => {
      expect(script).toContain('setPointerCapture');
      expect(script).toContain("addEventListener('pointerdown'");
      expect(script).toContain("addEventListener('pointermove'");
      expect(script).not.toContain('dragstart');
      expect(script).not.toContain('dataTransfer');
    });

    it('requires deliberate intent on touch so the board can still be scrolled', () => {
      expect(script).toContain("event.pointerType !== 'mouse'");
      expect(script).toContain('300');
      expect(script).toContain('goals-grip');
    });

    it('batches pointer movement into one animation frame', () => {
      expect(script).toContain('requestAnimationFrame(paint)');
    });

    it('cancels cleanly on Escape, pointercancel and tab hide', () => {
      expect(script).toContain("addEventListener('pointercancel'");
      expect(script).toContain('endDrag(false)');
      expect(script).toContain("addEventListener('visibilitychange'");
    });

    it('creates runtime nodes inside the scoped wrapper', () => {
      expect(script).toContain("document.querySelector('.goals-root')");
      expect(script).toContain('root().appendChild(ghost)');
      expect(script).toContain('root().appendChild(menu)');
    });
  });

  describe('live refresh', () => {
    it('ignores its own echo and other boards', () => {
      expect(script).toContain('data.originId === CLIENT_ID');
      expect(script).toContain('data.boardId !== BOARD_ID');
    });

    it('never swaps the DOM under an in-progress drag or request', () => {
      expect(script).toContain('if (dragging || inFlight > 0) { pendingRefresh = true; return; }');
      // Re-checked after the fetch resolves, not only before it starts.
      const afterFetch = script.slice(script.indexOf('return res.text();'));
      expect(afterFetch).toContain('if (dragging || inFlight > 0) { pendingRefresh = true; return; }');
    });

    it('debounces and aborts a superseded refresh', () => {
      expect(script).toContain('setTimeout(refresh, 150)');
      expect(script).toContain('aborter.abort()');
      expect(script).toContain('new AbortController()');
    });

    it('replays a suppressed refresh once things settle', () => {
      expect(script).toContain('function settle()');
      expect(script).toContain('pendingRefresh = false; scheduleRefresh();');
    });
  });

  describe('accessibility', () => {
    it('provides a keyboard path for moving a card', () => {
      expect(script).toContain("event.key === 'm'");
      expect(script).toContain('event.altKey');
      expect(script).toContain("event.key === 'ArrowUp'");
    });

    it('announces completed moves', () => {
      expect(script).toContain('function announce(');
      expect(script).toContain("getElementById('goals-live')");
    });

    it('implements the standard menu keyboard model', () => {
      expect(script).toContain("event.key === 'Escape'");
      expect(script).toContain("event.key === 'Home'");
      expect(script).toContain("event.key === 'End'");
      expect(script).toContain("setAttribute('aria-expanded', 'true')");
    });

    it('builds menu labels as text nodes rather than markup', () => {
      expect(script).toContain('document.createTextNode(label)');
      expect(script).not.toContain('menu.innerHTML');
    });
  });

  describe('requests', () => {
    it('tags every mutation with the per-page client id', () => {
      expect(script).toContain('body.clientId = CLIENT_ID');
      expect(script).toContain("body.ajax = '1'");
    });

    it('checks the content type before parsing, so an HTML 401 reads clearly', () => {
      expect(script).toContain("type.indexOf('application/json') === -1");
      expect(script).toContain('Session expired');
    });

    it('posts moves to the same endpoint from drag, menu and keyboard', () => {
      expect([...script.matchAll(/'\/p\/goals\/cards\/move'/g)]).toHaveLength(1);
      expect(script).toContain('function moveCard(cardId, toColumnId, toIndex, label)');
    });
  });

  describe('other pages', () => {
    it('ships a script for the board index and the roster', () => {
      expect(INDEX_CLIENT_JS.startsWith('<script>')).toBe(true);
      expect(INDEX_CLIENT_JS).toContain('/p/goals/boards/create');

      expect(MEMBERS_CLIENT_JS.startsWith('<script>')).toBe(true);
      expect(MEMBERS_CLIENT_JS).toContain('goals-swatch');
    });

    it('keeps those scripts free of interpolation leftovers too', () => {
      expect(INDEX_CLIENT_JS).not.toContain('${');
      expect(MEMBERS_CLIENT_JS).not.toContain('${');
    });
  });
});
