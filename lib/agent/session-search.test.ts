import { describe, it, expect } from 'vitest';
import { searchSessions, type SearchableSession } from '@/lib/agent/session-search';

const base: Omit<SearchableSession, 'id' | 'title' | 'content' | 'updatedAt'> = {};

function sess(id: string, title: string, content: string, updatedAt = 0): SearchableSession {
  return { id, title, content, updatedAt, ...base };
}

describe('searchSessions', () => {
  it('空 query 返回空列表', () => {
    const data = [sess('a', 'Chat A', 'hello world')];
    expect(searchSessions(data, '')).toEqual([]);
    expect(searchSessions(data, '   ')).toEqual([]);
  });

  it('不区分大小写匹配标题与正文', () => {
    const data = [
      sess('a', 'Tool Debug', 'how to fix the error'),
      sess('b', 'other', 'the ERROR is here'),
    ];
    const hits = searchSessions(data, 'error');
    const ids = hits.map((h) => h.sessionId).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('标题命中权重高于正文命中（排序在前）', () => {
    const data = [
      sess('old-content', 'unrelated', 'zebra mention', 999),
      sess('new-title', 'zebra chat', 'nothing', 1),
    ];
    const hits = searchSessions(data, 'zebra');
    expect(hits[0].sessionId).toBe('new-title');
    expect(hits[0].matchedIn).toContain('title');
    expect(hits[1].sessionId).toBe('old-content');
  });

  it('同权重按 updatedAt 倒序（新的在前）', () => {
    const data = [
      sess('a', 'x', 'match', 100),
      sess('b', 'y', 'match', 300),
      sess('c', 'z', 'match', 200),
    ];
    const hits = searchSessions(data, 'match');
    expect(hits.map((h) => h.sessionId)).toEqual(['b', 'c', 'a']);
  });

  it('一条会话只产出一行，摘录取正文第一个命中附近', () => {
    const data = [
      sess('a', 'dup', 'alpha … needle … needle …', 0),
    ];
    const hits = searchSessions(data, 'needle');
    expect(hits.length).toBe(1);
    const h = hits[0];
    expect(h.snippet).toContain('needle');
    expect(typeof h.snippetIndex).toBe('number');
    expect(h.matchLength).toBe('needle'.length);
    // 高亮区间必须正好罩住命中词
    expect(h.snippet!.slice(h.snippetIndex!, h.snippetIndex! + h.matchLength!)).toBe('needle');
  });

  it('没有命中的会话不出现', () => {
    const data = [sess('a', 'one', 'aaa'), sess('b', 'two', 'bbb')];
    expect(searchSessions(data, 'zzz')).toEqual([]);
  });

  it('标题命中但正文无命中时仍出命中（matchedIn 只有 title）', () => {
    const data = [sess('a', 'needle haystack', 'nothing', 0)];
    const hits = searchSessions(data, 'needle');
    expect(hits).toHaveLength(1);
    expect(hits[0].matchedIn).toEqual(['title']);
    expect(hits[0].snippet).toBeUndefined();
  });
});
