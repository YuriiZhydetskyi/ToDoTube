// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { sanitizeFixtureRoot } from './fixture-sanitizer';

// Built on generic custom tags (rec-tile, etc.) — never real YouTube
// identifiers — so this file stays clear of the CI selector guard while still
// exercising the same scrubbing the resolver fixtures rely on.

function root(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

describe('sanitizeFixtureRoot', () => {
  it('removes scripts, styles, media, and comments', () => {
    const el = root(`
      <wrapper-el>
        <script>doEvil()</script>
        <style>.x{color:red}</style>
        <img>
        <svg><path></path></svg>
        <!-- a comment -->
        <keep-el></keep-el>
      </wrapper-el>
    `);
    sanitizeFixtureRoot(el);

    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('style')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('svg')).toBeNull();
    expect(el.innerHTML).not.toContain('a comment');
    expect(el.querySelector('keep-el')).not.toBeNull();
  });

  it('neutralizes visible text but keeps the node', () => {
    const el = root('<wrapper-el><title-el>Secret personal video title</title-el></wrapper-el>');
    sanitizeFixtureRoot(el);

    const title = el.querySelector('title-el')!;
    expect(title).not.toBeNull();
    expect(title.textContent).not.toContain('Secret');
    expect(title.textContent?.trim().length).toBeGreaterThan(0);
  });

  it('strips personal and volatile attributes', () => {
    const el = root(
      '<wrapper-el>' +
        '<a href="https://youtu.be/abc" title="A title" aria-label="watch" onclick="x()">link</a>' +
        '</wrapper-el>',
    );
    sanitizeFixtureRoot(el);

    const a = el.querySelector('a')!;
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.hasAttribute('title')).toBe(false);
    expect(a.hasAttribute('aria-label')).toBe(false);
    expect(a.hasAttribute('onclick')).toBe(false);
  });

  it('preserves the structural attributes the resolver keys on', () => {
    const el = root(
      '<wrapper-el id="columns" class="cols" role="main" data-foo="bar"></wrapper-el>',
    );
    sanitizeFixtureRoot(el);

    expect(el.getAttribute('id')).toBe('columns');
    expect(el.getAttribute('class')).toBe('cols');
    expect(el.getAttribute('role')).toBe('main');
    // data-* hooks keep their presence but lose any personal value.
    expect(el.hasAttribute('data-foo')).toBe(true);
    expect(el.getAttribute('data-foo')).toBe('');
  });

  it('keeps data-tt-* ground-truth markers verbatim', () => {
    const el = root('<wrapper-el data-tt-anchor="rightRail" data-tt-strategy="0"></wrapper-el>');
    sanitizeFixtureRoot(el);

    expect(el.getAttribute('data-tt-anchor')).toBe('rightRail');
    expect(el.getAttribute('data-tt-strategy')).toBe('0');
  });

  it('prunes long runs of same-tag children to a representative few', () => {
    const tiles = Array.from({ length: 20 }, () => '<rec-tile></rec-tile>').join('');
    const el = root(`<wrapper-el>${tiles}</wrapper-el>`);
    sanitizeFixtureRoot(el);

    expect(el.querySelectorAll('rec-tile').length).toBe(6);
  });

  it('never prunes a marked anchor that shares a tag with a list', () => {
    const tiles = Array.from({ length: 10 }, () => '<rec-tile></rec-tile>').join('');
    // The marked tile is the last one — it would be pruned without the guard.
    const el = root(
      `<wrapper-el>${tiles}<rec-tile data-tt-anchor="rightRail"></rec-tile></wrapper-el>`,
    );
    sanitizeFixtureRoot(el);

    expect(el.querySelector('[data-tt-anchor="rightRail"]')).not.toBeNull();
  });

  // --- Privacy guarantees ----------------------------------------------------
  // These pin the named PII/auth-stripping contract: cookies/tokens, account
  // names, watch history, and ytcfg/INNERTUBE config must never survive into a
  // committed fixture. A regression that widens what leaks fails here.

  it('blanks a token-bearing data-* attribute without dropping the element', () => {
    const secret = 'SECRET_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const el = root(`<wrapper-el><auth-el data-session-token="${secret}"></auth-el></wrapper-el>`);
    sanitizeFixtureRoot(el);

    const authEl = el.querySelector('auth-el')!;
    // The element (structural signal) survives...
    expect(authEl).not.toBeNull();
    // ...but the token value is gone. The implementation blanks data-* to '';
    // accept either blanked or removed, but the secret must not remain.
    expect(authEl.getAttribute('data-session-token') ?? '').toBe('');
    expect(el.outerHTML).not.toContain('SECRET');
    expect(el.outerHTML).not.toContain(secret);
  });

  it('removes inline scripts carrying ytcfg / INNERTUBE config', () => {
    const el = root(
      '<wrapper-el>' +
        '<config-el>' +
        '<script>ytcfg.set({"INNERTUBE_API_KEY":"AIzaSECRET","VISITOR_DATA":"CgtSECRET"});</script>' +
        '</config-el>' +
        '</wrapper-el>',
    );
    sanitizeFixtureRoot(el);

    expect(el.querySelector('script')).toBeNull();
    const html = el.outerHTML;
    expect(html).not.toContain('ytcfg');
    expect(html).not.toContain('INNERTUBE_API_KEY');
    expect(html).not.toContain('AIzaSECRET');
    expect(html).not.toContain('VISITOR_DATA');
    expect(html).not.toContain('CgtSECRET');
  });

  it('drops href/src carrying account and channel identifiers', () => {
    const el = root(
      '<wrapper-el>' +
        '<a href="/channel/UCsecret?account=me@example.com">channel</a>' +
        '<media-el src="https://i.ytimg.com/user/SECRETHANDLE/avatar.jpg"></media-el>' +
        '</wrapper-el>',
    );
    sanitizeFixtureRoot(el);

    const a = el.querySelector('a')!;
    expect(a.hasAttribute('href')).toBe(false);
    const media = el.querySelector('media-el')!;
    expect(media.hasAttribute('src')).toBe(false);

    const html = el.outerHTML;
    expect(html).not.toContain('UCsecret');
    expect(html).not.toContain('me@example.com');
    expect(html).not.toContain('SECRETHANDLE');
  });

  it('neutralizes a text node holding an account display name', () => {
    const el = root(
      '<wrapper-el><account-el>Signed in as Jane Q. Maintainer</account-el></wrapper-el>',
    );
    sanitizeFixtureRoot(el);

    const account = el.querySelector('account-el')!;
    // The node survives (layouts can collapse when empty) but the name is gone.
    expect(account).not.toBeNull();
    expect(account.textContent).not.toContain('Jane');
    expect(account.textContent).not.toContain('Maintainer');
    expect(el.outerHTML).not.toContain('Jane');
  });

  it('keeps data-tt-* markers while blanking sibling personal data-* values', () => {
    const el = root(
      '<wrapper-el data-tt-anchor="rightRail" data-tt-strategy="2" ' +
        'data-watch-history="watched: a,b,c" data-account="me@example.com"></wrapper-el>',
    );
    sanitizeFixtureRoot(el);

    // Ground-truth anchors are preserved verbatim...
    expect(el.getAttribute('data-tt-anchor')).toBe('rightRail');
    expect(el.getAttribute('data-tt-strategy')).toBe('2');
    // ...while personal data-* hooks keep presence but lose their value.
    expect(el.getAttribute('data-watch-history')).toBe('');
    expect(el.getAttribute('data-account')).toBe('');
    const html = el.outerHTML;
    expect(html).not.toContain('watched:');
    expect(html).not.toContain('me@example.com');
  });
});
