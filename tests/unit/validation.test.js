import { describe, expect, it } from 'vitest';
import { isSlug, newNonce, validateDisplayName, validateEmail, validatePassword, validateTrace } from '../../src/lib/validation.js';

const ok = { regionSlug: 'the-core', pattern: 'spark', color: '#5EE7FF', intensity: 0.6, persistence: 'lasting', nonce: newNonce() };

describe('validateTrace', () => {
  it('accepts and normalizes a valid draft', () => {
    const r = validateTrace(ok);
    expect(r.ok).toBe(true);
    expect(r.value.color).toBe('#5ee7ff');
  });

  it.each([
    [{ regionSlug: '' }, 'region'],
    [{ regionSlug: '../etc' }, 'region'],
    [{ pattern: 'explosion' }, 'pattern'],
    [{ color: 'red' }, 'color'],
    [{ color: '#fff' }, 'color'],
    [{ color: 'javascript:alert(1)' }, 'color'],
    [{ intensity: 0 }, 'intensity'],
    [{ intensity: 1.5 }, 'intensity'],
    [{ intensity: 'lots' }, 'intensity'],
    [{ persistence: 'forever' }, 'persistence'],
    [{ nonce: 'not-a-uuid' }, 'nonce'],
  ])('rejects %o', (patch, field) => {
    const r = validateTrace({ ...ok, ...patch });
    expect(r.ok).toBe(false);
    expect(r.field).toBe(field);
  });

  it('rejects non-objects', () => {
    expect(validateTrace(null).ok).toBe(false);
  });
});

describe('other validators', () => {
  it('display names', () => {
    expect(validateDisplayName('  Lumen   Seeker ').value).toBe('Lumen Seeker');
    expect(validateDisplayName('Ünïcødé-1').ok).toBe(true);
    expect(validateDisplayName('a').ok).toBe(false);
    expect(validateDisplayName('<script>').ok).toBe(false);
    expect(validateDisplayName('x'.repeat(25)).ok).toBe(false);
  });
  it('email and password', () => {
    expect(validateEmail('a@b.co').ok).toBe(true);
    expect(validateEmail('nope').ok).toBe(false);
    expect(validatePassword('short').ok).toBe(false);
    expect(validatePassword('long enough pw').ok).toBe(true);
  });
  it('slugs and nonces', () => {
    expect(isSlug('the-first-trace')).toBe(true);
    expect(isSlug('The First')).toBe(false);
    const a = newNonce();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newNonce()).not.toBe(a);
  });
});
