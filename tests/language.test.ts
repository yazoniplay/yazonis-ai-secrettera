import { describe, expect, it } from 'vitest';
import { detectLanguage, getReceptionPhrases } from '../src/language.js';

describe('detectLanguage', () => {
  it('detects Arabic script', () => {
    expect(detectLanguage('مرحبا، كيف حالك؟')).toBe('ar');
  });

  it('detects Swedish words and characters', () => {
    expect(detectLanguage('Hej, jag behöver hjälp tack.')).toBe('sv');
    expect(detectLanguage('Kan du hjälpa mig?')).toBe('sv');
  });

  it('detects English', () => {
    expect(detectLanguage('Hello, can you help me?')).toBe('en');
  });

  it('uses the configured fallback for ambiguous short text', () => {
    expect(detectLanguage('Okay', 'sv')).toBe('sv');
  });
});

describe('getReceptionPhrases', () => {
  it.each(['en', 'sv', 'ar'] as const)('provides all receptionist phrases for %s', (language) => {
    const result = getReceptionPhrases(language);
    expect(result.greeting.length).toBeGreaterThan(0);
    expect(result.unavailable.length).toBeGreaterThan(0);
    expect(result.takeMessage.length).toBeGreaterThan(0);
  });
});
