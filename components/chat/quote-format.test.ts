import { describe, expect, it } from 'vitest';
import {
  composeOutgoingMessage,
  quoteBlocks,
  quoteChipLabel,
  quoteCopyText,
} from '@/components/chat/quote-format';

describe('quoteBlocks', () => {
  it('renders pieces as plain context blocks (no markdown), labeled by source', () => {
    expect(quoteBlocks([
      { text: 'a line\n\nb', attribution: 'Assistant:' },
      { text: 'you said', attribution: 'You:' },
    ])).toBe('From Assistant:\na line\n\nb\n\nFrom You:\nyou said');
  });

  it('merges adjacent pieces from the same source and skips blank ones', () => {
    expect(quoteBlocks([
      { text: 'part one', attribution: 'Assistant:' },
      { text: '  \n', attribution: 'You:' },
      { text: 'part two\r\n', attribution: 'Assistant:' },
    ])).toBe('From Assistant:\npart one\n\npart two');
  });

  it('normalizes line endings, trailing whitespace and blank-line runs', () => {
    expect(quoteBlocks([{ text: '\n\n  indented  \r\nnext\t\r\n\n\n\nlast\n\n' }]))
      .toBe('  indented\nnext\n\nlast');
  });

  it('omits the "From" line when there is no attribution', () => {
    expect(quoteBlocks([{ text: 'raw' }])).toBe('raw');
    expect(quoteBlocks([{ text: 'raw', attribution: '  ' }])).toBe('raw');
  });

  it('returns an empty string when all pieces are blank', () => {
    expect(quoteBlocks([{ text: '   ' }])).toBe('');
    expect(quoteBlocks([])).toBe('');
  });

  it('does not mutate its input', () => {
    const pieces = [{ text: 'a', attribution: 'You:' }, { text: 'b', attribution: 'You:' }];
    quoteBlocks(pieces);
    expect(pieces).toEqual([{ text: 'a', attribution: 'You:' }, { text: 'b', attribution: 'You:' }]);
  });
});

describe('quoteCopyText', () => {
  it('copies only the selected text, without attribution lines', () => {
    expect(quoteCopyText([
      { text: 'question\r\n', attribution: 'You:' },
      { text: 'answer', attribution: 'Assistant:' },
    ])).toBe('question\n\nanswer');
  });

  it('returns an empty string for a blank selection', () => {
    expect(quoteCopyText([{ text: ' \n ' }])).toBe('');
  });
});

describe('composeOutgoingMessage', () => {
  it('puts the quoted context first, typed text after, separated by a blank line', () => {
    expect(composeOutgoingMessage('explain more', [{ text: 'the key part', attribution: 'Assistant:' }]))
      .toBe('From Assistant:\nthe key part\n\nexplain more');
  });

  it('uses the quote alone when nothing was typed', () => {
    expect(composeOutgoingMessage('   ', [{ text: 'x' }])).toBe('x');
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
    expect(quoteChipLabel([{ text: ' ' }, { text: '\n  short  \nmore' }])).toBe('short');
    expect(quoteChipLabel([])).toBe('');
  });
});
