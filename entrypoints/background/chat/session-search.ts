// 会话关键词搜索的后台侧（issue #101）：把「拉会话 → 抽可搜索文本 → 匹配排序」
// 整段收在 background 里跑——transcript 本体在 Dexie 的 sessionMutations 表，
// 只有 background 是它的读取方，sidepanel 拿不到闭会内容。
//
// - 全程只读：经 sessionStore.readMessages 从盘上重放 main 分支，不触发迁移懒重试、
//   不往 repo 缓存里留树句柄。迁移失败行的日志不完整，只搜标题。
// - 可搜索文本按会话做小缓存，键 = messageCount + updatedAt；命中即免重读 mutation
//   日志。每次搜索顺手逐出已不在列表里的会话（删除 / 备份恢复后不留死条目）。
// - 只索引 user / assistant 正文（见 extractSearchableMessages），不含 toolResult。

import {
  extractSearchableMessages,
  searchSessions,
  type SearchableMessage,
  type SearchableSession,
} from '@/lib/agent/session-search';
import type { SessionSearchHit, SessionSearchScope } from '@/lib/ipc/protocol';
import { sessionStore } from './session-store';

/** 单条会话的逐条可搜文本，带键供缓存判等。 */
interface CachedText {
  key: string;
  messages: SearchableMessage[];
}

const cache = new Map<string, CachedText>();

function cacheKey(count: number, updatedAt: number): string {
  return `${count}:${updatedAt}`;
}

/**
 * 搜一批会话（标题 + 正文，不区分大小写）。scope 的 since / until 按
 * 会话 updatedAt 过滤。命中排序 / 摘录由纯函数 searchSessions 负责。
 */
async function searchAllSessions(
  query: string,
  scope: SessionSearchScope = {},
): Promise<SessionSearchHit[]> {
  const metas = await sessionStore.list();

  const alive = new Set(metas.map((m) => m.id));
  for (const id of cache.keys()) {
    if (!alive.has(id)) cache.delete(id);
  }

  const searchable: SearchableSession[] = [];
  for (const meta of metas) {
    if (scope.since !== undefined && meta.updatedAt < scope.since) continue;
    if (scope.until !== undefined && meta.updatedAt > scope.until) continue;
    const base = { id: meta.id, title: meta.title, updatedAt: meta.updatedAt };
    // 空会话 / 迁移失败行：只搜标题
    if (meta.messageCount === 0 || meta.treeMigrationFailed) {
      searchable.push({ ...base, messages: [] });
      continue;
    }
    const key = cacheKey(meta.messageCount, meta.updatedAt);
    let entry = cache.get(meta.id);
    if (!entry || entry.key !== key) {
      entry = { key, messages: extractSearchableMessages(await sessionStore.readMessages(meta.id)) };
      cache.set(meta.id, entry);
    }
    searchable.push({ ...base, messages: entry.messages });
  }
  return searchSessions(searchable, query);
}

// ─── Public API ───

export { searchAllSessions };
