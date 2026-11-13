import { describe, expect, it } from 'vitest';
import { quoteChipLabel, quoteCopyText, quoteKey } from '@/components/chat/quote-format';

describe('quoteCopyText', () => {
  it('copies only the selected text, without attribution', () => {
    expect(quoteCopyText([
      { text: 'question\r\n', source: 'user' },
      { text: 'answer', source: 'assistant' },
    ])).toBe('question\n\nanswer');
  });

  it('returns an empty string for a blank selection', () => {
    expect(quoteCopyText([{ text: ' \n ' }])).toBe('');
  });
});

describe('quoteChipLabel', () => {
  it('shows only the quoted text, truncating long first lines', () => {
    expect(quoteChipLabel([{ text: 'A'.repeat(60), source: 'assistant' }])).toBe(`${'A'.repeat(40)}…`);
    expect(quoteChipLabel([{ text: 'short', source: 'user' }])).toBe('short');
  });

  it('uses the first non-blank line', () => {
    expect(quoteChipLabel([{ text: ' ' }, { text: '\n  short  \nmore' }])).toBe('short');
    expect(quoteChipLabel([])).toBe('');
  });
});

describe('quoteKey', () => {
  it('treats the same passage (after normalization) as a duplicate', () => {
    expect(quoteKey([{ text: 'same\r\n', source: 'assistant' }]))
      .toBe(quoteKey([{ text: 'same', source: 'assistant' }]));
  });

  it('distinguishes different text or source', () => {
    expect(quoteKey([{ text: 'a', source: 'user' }])).not.toBe(quoteKey([{ text: 'a', source: 'assistant' }]));
    expect(quoteKey([{ text: 'a' }])).not.toBe(quoteKey([{ text: 'b' }]));
  });
});
