// 会话关键词搜索（issue #101）：纯函数，对一份「会话元数据 + 已归一的可搜索文本」
// 做不区分大小写的子串匹配，产出去重后的命中列表。
//
// 文本提取（标题 / user 正文 / assistant 正文 / toolResult 正文）在调用方完成——
// 这里只关心「给一个 query，按相关性排序返回命中」。相关性 = 标题命中权重高、
// 再按会话 updatedAt 新者优先，同分内稳定。

export interface SearchableSession {
  id: string;
  title: string;
  updatedAt: number;
  /** 预拼接好的全文（消息正文已抽取、换行归一），调用方负责构建。 */
  content: string;
}

export interface SearchHit {
  sessionId: string;
  title: string;
  updatedAt: number;
  /** 命中的位置集合：'title' / 'content'，content 再带上下文摘录。 */
  matchedIn: Array<'title' | 'content'>;
  /** content 命中时第一条命中处附近 ±60 字的摘录（不区分大小写高亮用的定位）。 */
  snippet?: string;
  /** 摘录里命中词起点的下标（相对 snippet，小写化前）。 */
  snippetIndex?: number;
  /** 命中词字符长度（query 归一化后），与 snippetIndex 一起划出高亮区间。 */
  matchLength?: number;
}

const SNIPPET_RADIUS = 60;

/** 把 query 转成可匹配的规范化小写串；空串直接返回 null（调用方判空）。 */
function normalizeQuery(query: string): string | null {
  const q = query.trim().toLowerCase();
  return q.length > 0 ? q : null;
}

/** 取一条命中内容里第一个命中处附近 ±radius 的摘录。
 * 摘录保持原文（含换行），高亮区间按命中词在原文里的 [start, start+matchLength) 给出。 */
function makeSnippet(
  content: string,
  lowerContent: string,
  q: string,
): { snippet: string; index: number; matchLength: number } | null {
  const at = lowerContent.indexOf(q);
  if (at < 0) return null;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(content.length, at + q.length + SNIPPET_RADIUS);
  const snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
  // 归一化空白会压缩下标——重算命中词在新串里的起点，保证高亮不偏。
  const index = snippet.toLowerCase().indexOf(q);
  if (index < 0) return { snippet, index: 0, matchLength: q.length };
  return { snippet, index, matchLength: q.length };
}

/**
 * 在一组会话里找 query（不区分大小写）。
 * - query 为空返回 []。
 * - 标题命中排前（标题权重 > 正文），同权重按 updatedAt 倒序。
 * - 每条会话只出一条（取正文第一个命中做摘录）。
 */
export function searchSessions(
  sessions: readonly SearchableSession[],
  query: string,
): SearchHit[] {
  const q = normalizeQuery(query);
  if (!q) return [];

  interface Scored {
    hit: SearchHit;
    score: number;
  }
  const scored: Scored[] = [];

  for (const s of sessions) {
    const titleMatch = s.title.toLowerCase().includes(q);
    const lowerContent = s.content.toLowerCase();
    const contentMatch = lowerContent.includes(q);
    if (!titleMatch && !contentMatch) continue;

    const matchedIn: SearchHit['matchedIn'] = [];
    if (titleMatch) matchedIn.push('title');
    let snippet: string | undefined;
    let snippetIndex: number | undefined;
    let matchLength: number | undefined;
    if (contentMatch) {
      matchedIn.push('content');
      const snip = makeSnippet(s.content, lowerContent, q);
      if (snip) {
        snippet = snip.snippet;
        snippetIndex = snip.index;
        matchLength = snip.matchLength;
      }
    }

    const hit: SearchHit = {
      sessionId: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      matchedIn,
      ...(snippet !== undefined ? { snippet, snippetIndex, matchLength } : {}),
    };
    // 权重：标题命中 +1000（排最前），正文命中 +1；同权重由 updatedAt 决先后
    const score = (titleMatch ? 1000 : 0) + (contentMatch ? 1 : 0);
    scored.push({ hit, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return b.hit.updatedAt - a.hit.updatedAt;
  });

  return scored.map((s) => s.hit);
}
