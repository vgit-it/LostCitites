import { describe, expect, it } from 'vitest';
import { InMemoryRoomRegistry, isValidCode } from './registry';
import { mulberry32 } from './rng';
import { FakeChannel } from './testDoubles';

const newRegistry = (rng = mulberry32(4)) =>
  new InMemoryRoomRegistry(() => new FakeChannel(), rng);

describe('code format', () => {
  it('accepts 100-999 and rejects a leading zero', () => {
    expect(isValidCode('100')).toBe(true);
    expect(isValidCode('999')).toBe(true);
    expect(isValidCode('099')).toBe(false);
    expect(isValidCode('99')).toBe(false);
    expect(isValidCode('1000')).toBe(false);
    expect(isValidCode('abc')).toBe(false);
  });

  it('generates codes inside the range, with no leading zero', () => {
    const registry = newRegistry();
    for (let i = 0; i < 100; i++) {
      expect(isValidCode(registry.create().room.code)).toBe(true);
    }
  });
});

describe('lookup', () => {
  it('finds a created room by its code', () => {
    const registry = newRegistry();
    const entry = registry.create();
    expect(registry.get(entry.room.code)).toBe(entry);
  });

  it('returns undefined for an unknown code', () => {
    expect(newRegistry().get('404')).toBeUndefined();
  });

  it('keeps rooms distinct', () => {
    const registry = newRegistry();
    const a = registry.create();
    const b = registry.create();

    expect(a.room.code).not.toBe(b.room.code);
    expect(a.room).not.toBe(b.room);
  });
});

describe('preferred codes', () => {
  it('honours a well-formed free code', () => {
    expect(newRegistry().create('456').room.code).toBe('456');
  });

  it('generates instead when the preferred code is malformed', () => {
    const registry = newRegistry();
    expect(registry.create('7').room.code).not.toBe('7');
  });

  it('generates instead when the preferred code is taken', () => {
    const registry = newRegistry();
    registry.create('321');
    const second = registry.create('321');

    expect(second.room.code).not.toBe('321');
    expect(registry.get('321')).not.toBe(second);
  });

  it('retries on a generated collision', () => {
    // 100 + floor(rng * 900): 0 -> '100' twice, then 0.5 -> '550'.
    const scripted = [0, 0, 0.5];
    let i = 0;
    const registry = newRegistry(() => scripted[i++]);

    expect(registry.create().room.code).toBe('100');
    expect(registry.create().room.code).toBe('550');
  });
});
