/**
 * Keyboard shortcut handler and help overlay
 */

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────

/**
 * Return a <script> block implementing keyboard shortcuts.
 *
 * Global: ? (help), t (theme), / (focus search), Escape (close/blur)
 * Session list: j/k (navigate cards), Enter (open), s (star), n (new), 1/2/3 (tabs)
 * Conversation detail: j/k (scroll), s (star), a (archive), c (copy), e (export), h/Backspace (back)
 */
export function getKeyboardShortcutScript(): string {
  return `
  <script>
  (function() {
    var focusIndex = -1;
    function getCards() { return document.querySelectorAll('.session-card'); }
    function isSessionList() { return getCards().length > 0; }
    function isConvDetail() { return !!document.querySelector('.conv-header'); }

    function updateFocus(cards, idx) {
      cards.forEach(function(c) { c.classList.remove('kb-focused'); });
      if (idx >= 0 && idx < cards.length) {
        cards[idx].classList.add('kb-focused');
        cards[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function isOverlayOpen() {
      var help = document.getElementById('keyboard-help');
      return help && help.style.display !== 'none';
    }

    document.addEventListener('keydown', function(e) {
      var tag = e.target.tagName;
      var isFormElement = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
      if (isFormElement) {
        if (e.key === 'Escape') { e.target.blur(); }
        return;
      }

      // Global: ? toggle help overlay
      if (e.key === '?') {
        e.preventDefault();
        var help = document.getElementById('keyboard-help');
        if (help) {
          var isOpen = help.style.display !== 'none';
          help.style.display = isOpen ? 'none' : 'flex';
          if (!isOpen) {
            // Focus the overlay content for accessibility
            var content = help.querySelector('.kb-overlay-content');
            if (content) content.focus();
          }
        }
        return;
      }

      // Global: Escape — hide help, blur
      if (e.key === 'Escape') {
        var helpEl = document.getElementById('keyboard-help');
        if (helpEl && helpEl.style.display !== 'none') { helpEl.style.display = 'none'; return; }
        if (document.activeElement) document.activeElement.blur();
        return;
      }

      // Don't fire other shortcuts when help overlay is open
      if (isOverlayOpen()) return;

      // Global: t — toggle theme
      if (e.key === 't') {
        var tb = document.getElementById('theme-toggle');
        if (tb) tb.click();
        return;
      }

      // Global: / — focus search input
      if (e.key === '/') {
        var si = document.querySelector('.search-input') || document.getElementById('continue-input');
        if (si) { e.preventDefault(); si.focus(); }
        return;
      }

      // Navigation shortcuts only fire when focus is on body (not on buttons/links)
      var onBody = !document.activeElement || document.activeElement === document.body;

      // Session list shortcuts
      if (isSessionList()) {
        var cards = getCards();
        if (cards.length === 0) return;
        if (e.key === 'j') { focusIndex = Math.min(focusIndex + 1, cards.length - 1); updateFocus(cards, focusIndex); return; }
        if (e.key === 'k') { focusIndex = Math.max(focusIndex - 1, 0); updateFocus(cards, focusIndex); return; }
        if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < cards.length) {
          var href = cards[focusIndex].getAttribute('href');
          if (href && href.charAt(0) === '/') window.location.href = href;
          return;
        }
        if (e.key === 's' && focusIndex >= 0 && focusIndex < cards.length) {
          var star = cards[focusIndex].querySelector('.favorite-star');
          if (star) star.click();
          return;
        }
        if (e.key === 'n') { window.location.href = '/c/new'; return; }
        var tabKeys = ['1','2','3'];
        if (tabKeys.indexOf(e.key) !== -1) {
          var tabs = document.querySelectorAll('.nav-tabs a');
          var ti = parseInt(e.key, 10) - 1;
          if (tabs[ti]) { var tabHref = tabs[ti].getAttribute('href'); if (tabHref && tabHref.charAt(0) === '/') window.location.href = tabHref; }
          return;
        }
      }

      // Conversation detail shortcuts
      if (isConvDetail()) {
        if (e.key === 'j') { window.scrollBy({ top: 200, behavior: 'smooth' }); return; }
        if (e.key === 'k') { window.scrollBy({ top: -200, behavior: 'smooth' }); return; }
        if (e.key === 's') { var ds = document.querySelector('.detail-favorite-star'); if (ds) ds.click(); return; }
        if (e.key === 'a') { var ab = document.getElementById('archive-btn'); if (ab) ab.click(); return; }
        if (e.key === 'c') { var cb = document.getElementById('copy-clipboard'); if (cb) cb.click(); return; }
        if (e.key === 'e') { var eb = document.getElementById('export-md'); if (eb) eb.click(); return; }
        if (onBody && (e.key === 'h' || e.key === 'Backspace')) {
          var bl = document.querySelector('.conv-back');
          if (bl) { var backHref = bl.getAttribute('href'); if (backHref && backHref.charAt(0) === '/') window.location.href = backHref; }
          return;
        }
      }
    });
  })();
  </script>`;
}

/**
 * Return the keyboard help overlay HTML (hidden by default)
 */
export function getKeyboardHelpOverlay(): string {
  return `
  <div id="keyboard-help" class="kb-overlay" style="display:none;" role="dialog" aria-labelledby="kb-overlay-title">
    <div class="kb-overlay-content" tabindex="-1">
      <h2 id="kb-overlay-title">Keyboard Shortcuts</h2>
      <table>
        <tr><th>Key</th><th>Action</th></tr>
        <tr><td><kbd>?</kbd></td><td>Toggle this help</td></tr>
        <tr><td><kbd>t</kbd></td><td>Toggle theme</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus search</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close / blur</td></tr>
        <tr><td colspan="2" style="color:var(--accent);padding-top:8px;">Session List</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Navigate cards</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Open conversation</td></tr>
        <tr><td><kbd>s</kbd></td><td>Toggle star</td></tr>
        <tr><td><kbd>n</kbd></td><td>New conversation</td></tr>
        <tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td><td>Switch tab</td></tr>
        <tr><td colspan="2" style="color:var(--accent);padding-top:8px;">Conversation</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Scroll down / up</td></tr>
        <tr><td><kbd>s</kbd></td><td>Toggle star</td></tr>
        <tr><td><kbd>a</kbd></td><td>Archive</td></tr>
        <tr><td><kbd>c</kbd></td><td>Copy to clipboard</td></tr>
        <tr><td><kbd>e</kbd></td><td>Export markdown</td></tr>
        <tr><td><kbd>h</kbd></td><td>Back to list</td></tr>
      </table>
      <p class="kb-hint">Press <kbd>?</kbd> to close</p>
    </div>
  </div>`;
}
