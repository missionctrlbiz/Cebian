// 会话关键词搜索（issue #101）：纯函数。
//
// - `extractSearchableMessages`：把一条会话 main 分支投影出的 messages 抽成「逐条可搜
//   文本」，只取 user / assistant 正文（toolResult 多是整页 DOM / 文件转储，噪声大、
//   缓存体积也大，故不入索引）。每条带它在投影数组里的下标，供 UI 跳到那条消息。
// - `matchSessions`：对一组「会话元数据 + 逐条文本」做不区分大小写的子串匹配，
//   每条会话出一行命中：标题命中权重高，同权重按 updatedAt 新者优先。

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { extractUserText, getAssistantText } from '@/lib/agent/message-helpers';
import type { SessionSearchHit } from '@/lib/ipc/protocol';

/** 一条可搜索消息：空白已归一的正文 + 它在投影 messages 数组里的下标。 */
interface SearchableMessage {
  index: number;
  text: string;
}

interface SearchableSession {
  id: string;
  title: string;
  updatedAt: number;
  /** 按消息序排列的可搜文本（调用方用 extractSearchableMessages 构建）。 */
  messages: readonly SearchableMessage[];
}

const SNIPPET_RADIUS = 60;
const ELLIPSIS = '…';

/** 空白归一：连续空白压成一个空格并去首尾。消息文本与 query 共用同一口径。 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 不区分大小写地在 hay 里找 needle（needle 已小写）。返回原串里的 [start, end)。
 * 常态下 toLowerCase 不改变长度，直接 indexOf；个别字符（如 'İ'）小写后变长时，
 * 逐字符折叠并记下「折叠串下标 → 原串下标」映射再找，保证区间落在原串上不偏。
 */
function findFolded(hay: string, needle: string): { start: number; end: number } | null {
  const lower = hay.toLowerCase();
  if (lower.length === hay.length) {
    const at = lower.indexOf(needle);
    return at < 0 ? null : { start: at, end: at + needle.length };
  }
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < hay.length; ) {
    const cp = hay.codePointAt(i)!;
    const width = cp > 0xffff ? 2 : 1;
    const piece = String.fromCodePoint(cp).toLowerCase();
    for (let k = 0; k < piece.length; k++) map.push(i);
    folded += piece;
    i += width;
  }
  map.push(hay.length);
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  const start = map[at];
  // 末端映射到「命中最后一个折叠字符所属原字符」之后
  const lastOrig = map[at + needle.length - 1];
  const lastCp = hay.codePointAt(lastOrig)!;
  return { start, end: lastOrig + (lastCp > 0xffff ? 2 : 1) };
}

/** 摘录边界别切开代理对（否则会渲染出 �）。 */
function isLowSurrogate(text: string, i: number): boolean {
  const c = text.charCodeAt(i);
  return c >= 0xdc00 && c <= 0xdfff;
}

/** 以 [start, end) 为中心切 ±SNIPPET_RADIUS 的摘录，并给出命中词在摘录里的区间。 */
function makeSnippet(
  text: string,
  start: number,
  end: number,
): { snippet: string; index: number; length: number } {
  let from = Math.max(0, start - SNIPPET_RADIUS);
  let to = Math.min(text.length, end + SNIPPET_RADIUS);
  if (from > 0 && isLowSurrogate(text, from)) from++;
  if (to < text.length && isLowSurrogate(text, to)) to++;
  const head = from > 0 ? ELLIPSIS : '';
  const tail = to < text.length ? ELLIPSIS : '';
  return {
    snippet: head + text.slice(from, to) + tail,
    index: head.length + (start - from),
    length: end - start,
  };
}

/**
 * 从投影 messages 抽出逐条可搜文本：只取 user（去信封）与 assistant（正文块），
 * 其余角色（toolResult、压缩摘要、权限卡等）不入索引。空文本跳过；下标保持原位。
 */
function extractSearchableMessages(messages: readonly AgentMessage[]): SearchableMessage[] {
  const out: SearchableMessage[] = [];
  messages.forEach((m, index) => {
    let raw = '';
    if (m.role === 'user') raw = extractUserText(m);
    else if (m.role === 'assistant') raw = getAssistantText(m);
    else return;
    const text = normalizeWhitespace(raw);
    if (text) out.push({ index, text });
  });
  return out;
}

/**
 * 在一组会话里找 query（不区分大小写，query 内空白按单空格匹配）。
 * - query 为空返回 []。
 * - 标题命中排前（标题权重 > 正文），同权重按 updatedAt 倒序。
 * - 每条会话只出一行：正文取按消息序的第一处命中做摘录与定位。
 */
function matchSessions(sessions: readonly SearchableSession[], query: string): SessionSearchHit[] {
  const q = normalizeWhitespace(query).toLowerCase();
  if (!q) return [];

  const scored: Array<{ hit: SessionSearchHit; titleMatch: boolean }> = [];
  for (const s of sessions) {
    const titleMatch = findFolded(s.title, q) !== null;
    let content: SessionSearchHit | null = null;
    for (const m of s.messages) {
      const range = findFolded(m.text, q);
      if (!range) continue;
      const snip = makeSnippet(m.text, range.start, range.end);
      content = {
        sessionId: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        matchedIn: [],
        messageIndex: m.index,
        snippet: snip.snippet,
        snippetIndex: snip.index,
        matchLength: snip.length,
      };
      break;
    }
    if (!titleMatch && !content) continue;
    const matchedIn: SessionSearchHit['matchedIn'] = [];
    if (titleMatch) matchedIn.push('title');
    if (content) matchedIn.push('content');
    const hit: SessionSearchHit = content
      ? { ...content, matchedIn }
      : { sessionId: s.id, title: s.title, updatedAt: s.updatedAt, matchedIn };
    scored.push({ hit, titleMatch });
  }

  scored.sort((a, b) => {
    if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    return b.hit.updatedAt - a.hit.updatedAt;
  });
  return scored.map((s) => s.hit);
}

// ─── Public API ───

export { extractSearchableMessages, matchSessions };
export type { SearchableMessage, SearchableSession };
