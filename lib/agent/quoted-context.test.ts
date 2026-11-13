import { describe, expect, it } from 'vitest';
import { composeQuotedRequest, mergeQuotes, splitQuotedRequest } from '@/lib/agent/quoted-context';

describe('composeQuotedRequest', () => {
  it('puts tagged quote blocks first and the typed text after', () => {
    expect(composeQuotedRequest([{ text: 'the key part', source: 'assistant' }], 'explain more')).toBe(
      '<quoted-context source="assistant">\nthe key part\n</quoted-context>\n\nexplain more',
    );
  });

  it('uses the quotes alone when nothing was typed, and the text alone without quotes', () => {
    expect(composeQuotedRequest([{ text: 'x' }], '   ')).toBe('<quoted-context>\nx\n</quoted-context>');
    expect(composeQuotedRequest([], ' just text ')).toBe('just text');
    expect(composeQuotedRequest([{ text: '  \n' }], 'only text')).toBe('only text');
  });

  it('merges adjacent same-source pieces and keeps separate blocks per source', () => {
    expect(composeQuotedRequest([
      { text: 'q', source: 'user' },
      { text: 'part one', source: 'assistant' },
      { text: 'part two\r\n', source: 'assistant' },
    ], '')).toBe(
      '<quoted-context source="user">\nq\n</quoted-context>\n\n'
      + '<quoted-context source="assistant">\npart one\n\npart two\n</quoted-context>',
    );
  });
});

describe('splitQuotedRequest', () => {
  it('round-trips quotes and typed text', () => {
    const quotes = [{ text: 'line 1\n\nline 2', source: 'assistant' as const }, { text: 'mine', source: 'user' as const }];
    const request = composeQuotedRequest(quotes, 'what does this mean?');
    expect(splitQuotedRequest(request)).toEqual({ quotes, text: 'what does this mean?' });
  });

  it('round-trips text that contains the tag name itself', () => {
    const quotes = [{ text: 'see </quoted-context> and <quoted-context source="user">' }];
    expect(splitQuotedRequest(composeQuotedRequest(quotes, 'ok')).quotes).toEqual(quotes);
  });

  it('leaves a request without leading quote blocks untouched (only trimmed)', () => {
    expect(splitQuotedRequest('  hello <quoted-context>\nx\n</quoted-context>  ')).toEqual({
      quotes: [],
      text: 'hello <quoted-context>\nx\n</quoted-context>',
    });
  });

  it('returns empty text for a quote-only request', () => {
    expect(splitQuotedRequest('<quoted-context>\nx\n</quoted-context>')).toEqual({ quotes: [{ text: 'x' }], text: '' });
  });
});

describe('mergeQuotes', () => {
  it('normalizes text, drops blank pieces and does not mutate its input', () => {
    const input = [{ text: 'a  \r\n\n\n\nb', source: 'user' as const }, { text: ' ', source: 'user' as const }];
    expect(mergeQuotes(input)).toEqual([{ text: 'a\n\nb', source: 'user' }]);
    expect(input[0].text).toBe('a  \r\n\n\n\nb');
  });
});
