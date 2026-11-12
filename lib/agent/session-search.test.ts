import { describe, it, expect } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  extractSearchableMessages,
  searchSessions,
  type SearchableSession,
  type SearchHit,
} from '@/lib/agent/session-search';

function sess(id: string, title: string, texts: string[], updatedAt = 0): SearchableSession {
  return { id, title, updatedAt, messages: texts.map((text, index) => ({ index, text })) };
}

/** 高亮区间在 snippet 上切出来的原文。 */
function highlighted(h: SearchHit): string {
  return h.snippet!.slice(h.snippetIndex!, h.snippetIndex! + h.matchLength!);
}

describe('searchSessions', () => {
  it('空 query 返回空列表', () => {
    const data = [sess('a', 'Chat A', ['hello world'])];
    expect(searchSessions(data, '')).toEqual([]);
    expect(searchSessions(data, '   ')).toEqual([]);
  });

  it('不区分大小写匹配标题与正文', () => {
    const data = [
      sess('a', 'Tool Debug', ['how to fix the error']),
      sess('b', 'other', ['the ERROR is here']),
    ];
    const ids = searchSessions(data, 'error').map((h) => h.sessionId).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('标题命中权重高于正文命中（排序在前）', () => {
    const data = [
      sess('old-content', 'unrelated', ['zebra mention'], 999),
      sess('new-title', 'zebra chat', ['nothing'], 1),
    ];
    const hits = searchSessions(data, 'zebra');
    expect(hits[0].sessionId).toBe('new-title');
    expect(hits[0].matchedIn).toEqual(['title']);
    expect(hits[1].sessionId).toBe('old-content');
  });

  it('同权重按 updatedAt 倒序（新的在前）', () => {
    const data = [
      sess('a', 'x', ['match'], 100),
      sess('b', 'y', ['match'], 300),
      sess('c', 'z', ['match'], 200),
    ];
    expect(searchSessions(data, 'match').map((h) => h.sessionId)).toEqual(['b', 'c', 'a']);
  });

  it('一条会话只出一行，取按消息序第一处命中，并给出其 messageIndex', () => {
    const data: SearchableSession[] = [{
      id: 'a',
      title: 'dup',
      updatedAt: 0,
      messages: [
        { index: 0, text: 'nothing here' },
        { index: 3, text: 'first Needle hit' },
        { index: 5, text: 'needle again' },
      ],
    }];
    const hits = searchSessions(data, 'needle');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageIndex).toBe(3);
    expect(hits[0].matchedIn).toEqual(['content']);
    expect(highlighted(hits[0])).toBe('Needle');
  });

  it('标题与正文都命中时两者都记，仍带 messageIndex', () => {
    const hits = searchSessions([sess('a', 'needle title', ['a needle'])], 'needle');
    expect(hits[0].matchedIn).toEqual(['title', 'content']);
    expect(hits[0].messageIndex).toBe(0);
  });

  it('没有命中的会话不出现', () => {
    expect(searchSessions([sess('a', 'one', ['aaa']), sess('b', 'two', ['bbb'])], 'zzz')).toEqual([]);
  });

  it('只有标题命中时没有摘录与 messageIndex', () => {
    const hits = searchSessions([sess('a', 'needle haystack', ['nothing'])], 'needle');
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedIn).toEqual(['title']);
    expect(hits[0].snippet).toBeUndefined();
    expect(hits[0].messageIndex).toBeUndefined();
  });

  it('长文本截出带省略号的摘录，高亮区间仍准确罩住命中词', () => {
    const text = `${'a'.repeat(200)} Target ${'b'.repeat(200)}`;
    const [hit] = searchSessions([sess('a', 't', [text])], 'target');
    expect(hit.snippet!.startsWith('…')).toBe(true);
    expect(hit.snippet!.endsWith('…')).toBe(true);
    expect(highlighted(hit)).toBe('Target');
    expect(hit.snippet!.length).toBeLessThan(text.length);
  });

  it('query 里的多余空白按单个空格匹配', () => {
    const [hit] = searchSessions([sess('a', 't', ['open the  door now'.replace(/\s+/g, ' ')])], '  the   door ');
    expect(highlighted(hit)).toBe('the door');
  });

  it('toLowerCase 会变长的字符不让高亮区间错位', () => {
    // 'İ'（U+0130）小写后是两个 UTF-16 单元，常规 indexOf 下标会偏一位
    const [hit] = searchSessions([sess('a', 't', ['İstanbul trip to Paris'])], 'paris');
    expect(highlighted(hit)).toBe('Paris');
  });
});

describe('extractSearchableMessages', () => {
  const messages = [
    { role: 'user', content: 'hello\n\n  world', timestamp: 0 },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'secret reasoning' },
        { type: 'text', text: 'the answer' },
      ],
      timestamp: 0,
    },
    {
      role: 'toolResult',
      toolCallId: 'c1',
      toolName: 'read_page',
      content: [{ type: 'text', text: 'huge page dump' }],
      isError: false,
      timestamp: 0,
    },
    { role: 'user', content: '   ', timestamp: 0 },
    { role: 'assistant', content: [{ type: 'text', text: 'second' }], timestamp: 0 },
  ] as unknown as AgentMessage[];

  it('只取 user / assistant 正文，空白归一，保留原下标', () => {
    expect(extractSearchableMessages(messages)).toEqual([
      { index: 0, text: 'hello world' },
      { index: 1, text: 'the answer' },
      { index: 4, text: 'second' },
    ]);
  });

  it('toolResult 与思考内容不入索引', () => {
    const sessions = [{ id: 's', title: 't', updatedAt: 0, messages: extractSearchableMessages(messages) }];
    expect(searchSessions(sessions, 'page dump')).toEqual([]);
    expect(searchSessions(sessions, 'secret')).toEqual([]);
  });
});
