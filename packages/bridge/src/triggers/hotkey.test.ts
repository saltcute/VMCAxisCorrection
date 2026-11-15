import { describe, expect, it } from 'vitest';
import { parseHotkey } from './hotkey.js';

describe('parseHotkey', () => {
  it('parses modifiers and key', () => {
    expect(parseHotkey('Ctrl+Alt+C')).toEqual({
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
      key: 'C',
    });
    expect(parseHotkey('Shift+F5')).toEqual({
      ctrl: false,
      alt: false,
      shift: true,
      meta: false,
      key: 'F5',
    });
    expect(parseHotkey('k').key).toBe('K');
  });
});
