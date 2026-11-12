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
  matchSessions,
  type SearchableMessage,
  type SearchableSession,
} from '@/lib/agent/session-search';
import type { SessionSearchHit } from '@/lib/ipc/protocol';
import { sessionStore } from './session-store';

/** 单条会话的逐条可搜文本（读取中即为在途 promise），带键供缓存判等。 */
interface CachedText {
  key: string;
  messages: Promise<SearchableMessage[]>;
}

// 只存 user / assistant 正文，随 SW 生命周期存活（SW 被回收即清空）。缓存的是
// promise：debounce 后并发的多次搜索在冷缓存上共享同一次读取，而不是各自全量重读。
const cache = new Map<string, CachedText>();

function cacheKey(count: number, updatedAt: number): string {
  return `${count}:${updatedAt}`;
}

/** 取一条会话的可搜文本：键一致复用（含在途读取），否则重读；读取失败不留缓存。 */
function readSearchable(id: string, key: string): Promise<SearchableMessage[]> {
  const cached = cache.get(id);
  if (cached && cached.key === key) return cached.messages;
  const messages = sessionStore.readMessages(id).then(extractSearchableMessages);
  const entry: CachedText = { key, messages };
  cache.set(id, entry);
  messages.catch(() => {
    if (cache.get(id) === entry) cache.delete(id);
  });
  return messages;
}

/** 搜全部会话（标题 + 正文，不区分大小写）。命中排序 / 摘录由纯函数 matchSessions 负责。 */
async function searchAllSessions(query: string): Promise<SessionSearchHit[]> {
  const metas = await sessionStore.list();

  const alive = new Set(metas.map((m) => m.id));
  for (const id of cache.keys()) {
    if (!alive.has(id)) cache.delete(id);
  }

  const searchable: SearchableSession[] = [];
  for (const meta of metas) {
    const base = { id: meta.id, title: meta.title, updatedAt: meta.updatedAt };
    // 空会话 / 迁移失败行：只搜标题
    if (meta.messageCount === 0 || meta.treeMigrationFailed) {
      searchable.push({ ...base, messages: [] });
      continue;
    }
    const messages = await readSearchable(meta.id, cacheKey(meta.messageCount, meta.updatedAt));
    searchable.push({ ...base, messages });
  }
  return matchSessions(searchable, query);
}

// ─── Public API ───

export { searchAllSessions };
