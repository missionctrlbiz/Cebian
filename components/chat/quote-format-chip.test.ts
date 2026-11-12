import { describe, expect, it } from 'vitest';
import {
  composeOutgoingMessage,
  quoteBlocks,
  quoteChipLabel,
} from './quote-format';

describe('quoteBlocks', () => {
  it('renders pieces as quote blocks, merged by source, attributed', () => {
    const blocks = quoteBlocks([
      { text: 'a line\n\nb', attribution: 'Assistant:' },
      { text: 'you said', attribution: 'You:' },
    ]);
    expect(blocks).toBe('> **Assistant:**\n> a line\n>\n> b\n\n> **You:**\n> you said');
  });

  it('returns empty string when all pieces are blank', () => {
    expect(quoteBlocks([{ text: '   ' }])).toBe('');
  });
});

describe('composeOutgoingMessage', () => {
  it('puts quote blocks first, typed text after, separated by a blank line', () => {
    const out = composeOutgoingMessage('explain more', [{ text: 'the key part', attribution: 'Assistant:' }]);
    expect(out).toBe('> **Assistant:**\n> the key part\n\nexplain more');
  });

  it('uses the quote alone when nothing was typed', () => {
    const out = composeOutgoingMessage('   ', [{ text: 'x' }]);
    expect(out).toBe('> x');
  });

  it('uses typed text alone when there is no quote', () => {
    expect(composeOutgoingMessage('just text', [])).toBe('just text');
  });
});

describe('quoteChipLabel', () => {
  it('labels the first non-blank piece with attribution and truncates long lines', () => {
    expect(quoteChipLabel([{ text: 'A'.repeat(60), attribution: 'Assistant:' }])).toBe(
      'Assistant: ' + 'A'.repeat(40) + '…',
    );
    expect(quoteChipLabel([{ text: 'short' }])).toBe('short');
    expect(quoteChipLabel([])).toBe('');
  });
});
