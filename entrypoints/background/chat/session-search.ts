// 会话关键词搜索的后台侧（issue #101）：把「拉会话 → 抽可搜索文本 → 匹配排序」
// 整段收在 background 里跑——transcript 本体在 Dexie 的 sessionMutations 表，
// 只有 background 是它的读取方，sidepanel 拿不到闭会内容。
//
// 响应式 / 体积考量（本机能跑到 110+ 条消息的长会话）：
// - 可搜索文本按会话做小缓存，键 = messageCount + updatedAt；命中即免重读
//   mutation 日志，反复搜同一批会话是 O(命中数) 而非 O(总消息数)。
// - 文本抽取用现成的 getAssistantText / extractUserText（正文抽取口径与 UI 渲染一致），
//   toolResult 取 content 的 text 块（工具卡结果也算「聊过的话」）。

import { getAssistantText, extractUserText } from '@/lib/agent/message-helpers';
import { searchSessions, type SearchableSession } from '@/lib/agent/session-search';
import type { SessionSearchHit, SessionSearchScope } from '@/lib/ipc/protocol';
import { sessionStore } from './session-store';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** 单条会话抽出的可搜索文本。带键供缓存判等。 */
interface SearchText {
  key: string;
  text: string;
}

const cache = new Map<string, SearchText>();

/** 取一条会话的正文（user / assistant / toolResult 三类，顺序即消息序）。 */
function extractContent(messages: readonly AgentMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    switch (m.role) {
      case 'user': {
        const t = extractUserText(m);
        if (t) parts.push(t);
        break;
      }
      case 'assistant': {
        const t = getAssistantText(m);
        if (t) parts.push(t);
        break;
      }
      case 'toolResult': {
        for (const b of m.content) {
          if (b.type === 'text' && b.text.trim()) parts.push(b.text);
        }
        break;
      }
      default:
        break;
    }
  }
  return parts.join('\n');
}

function cacheKey(count: number, updatedAt: number): string {
  return `${count}:${updatedAt}`;
}

/**
 * 搜一批会话（标题 + 正文，不区分大小写）。scope 的 since / until 按
 * 会话 updatedAt 过滤。命中排序 / 摘录由纯函数 searchSessions 负责。
 */
export async function searchAllSessions(
  query: string,
  scope: SessionSearchScope = {},
): Promise<SessionSearchHit[]> {
  const metas = await sessionStore.list();
  const searchable: SearchableSession[] = [];
  for (const meta of metas) {
    if (scope.since !== undefined && meta.updatedAt < scope.since) continue;
    if (scope.until !== undefined && meta.updatedAt > scope.until) continue;
    // messageCount = 0（新建空会话）只搜标题
    if (meta.messageCount === 0) {
      searchable.push({
        id: meta.id,
        title: meta.title,
        updatedAt: meta.updatedAt,
        content: '',
      });
      continue;
    }
    const key = cacheKey(meta.messageCount, meta.updatedAt);
    const cached = cache.get(meta.id);
    if (cached && cached.key === key) {
      searchable.push({
        id: meta.id,
        title: meta.title,
        updatedAt: meta.updatedAt,
        content: cached.text,
      });
      continue;
    }
    const record = await sessionStore.load(meta.id);
    const text = record ? extractContent(record.messages) : '';
    cache.set(meta.id, { key, text });
    searchable.push({
      id: meta.id,
      title: meta.title,
      updatedAt: meta.updatedAt,
      content: text,
    });
  }
  return searchSessions(searchable, query).map((h) => ({
    sessionId: h.sessionId,
    title: h.title,
    updatedAt: h.updatedAt,
    matchedIn: h.matchedIn,
    ...(h.snippet !== undefined ? { snippet: h.snippet, snippetIndex: h.snippetIndex, matchLength: h.matchLength } : {}),
  }));
}

// ─── Public API ───

/** 会话被删 / 备份重建后调（session-delete / restore 路径共用），清掉可能过期的键。 */
export function invalidateSessionSearchCache(sessionId?: string): void {
  if (sessionId === undefined) cache.clear();
  else cache.delete(sessionId);
}
