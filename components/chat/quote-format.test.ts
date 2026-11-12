import { describe, expect, it } from 'vitest';
import { appendQuoteToDraft } from '@/components/chat/quote-format';

describe('appendQuoteToDraft', () => {
  it('quotes each line into an empty draft and leaves a blank line to type below', () => {
    expect(appendQuoteToDraft('', 'first\nsecond')).toBe('> first\n> second\n\n');
  });

  it('normalizes CRLF and lone CR line endings', () => {
    expect(appendQuoteToDraft('', 'a\r\nb\rc')).toBe('> a\n> b\n> c\n\n');
  });

  it('keeps single blank lines as bare ">" and collapses longer runs', () => {
    expect(appendQuoteToDraft('', 'a\n\nb\n\n\n\nc')).toBe('> a\n>\n> b\n>\n> c\n\n');
  });

  it('trims trailing whitespace and leading / trailing blank lines', () => {
    expect(appendQuoteToDraft('', '\n\n  indented  \nnext\t\n \n\n')).toBe('>   indented\n> next\n\n');
  });

  it('separates the quote from existing draft text with one blank line', () => {
    expect(appendQuoteToDraft('Explain this:', 'x')).toBe('Explain this:\n\n> x\n\n');
    expect(appendQuoteToDraft('Explain this:\n\n\n', 'x')).toBe('Explain this:\n\n> x\n\n');
  });

  it('stacks consecutive quotes without piling up blank lines', () => {
    const once = appendQuoteToDraft('', 'one');
    expect(appendQuoteToDraft(once, 'two')).toBe('> one\n\n> two\n\n');
  });

  it('treats a whitespace-only draft as empty', () => {
    expect(appendQuoteToDraft('  \n ', 'x')).toBe('> x\n\n');
  });

  it('prefixes a bold attribution line when given', () => {
    expect(appendQuoteToDraft('', 'hello', 'Assistant:')).toBe('> **Assistant:**\n> hello\n\n');
    expect(appendQuoteToDraft('', 'hello', '  ')).toBe('> hello\n\n');
  });

  it('returns the draft unchanged when the selection is blank', () => {
    expect(appendQuoteToDraft('keep', ' \r\n\t ')).toBe('keep');
  });
});
