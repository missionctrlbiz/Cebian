// 会话关键词搜索的响应式包装（issue #101）：HistoryPanel 的搜索框用它。
//
// 每次按键 debounce 250ms 后发一次 `session_search`；后台按 requestId 回包，
// 这里只收「最后一次」请求的结果，更早的回包按世代号丢弃（stale guard）。
// `searching` 从按键那一刻起就为 true（覆盖 debounce + 在途），UI 据此显示
// 「搜索中」而不是闪一下「无结果」。出错置 error，用户重敲即重发。
// 面板关闭时清空查询，下次打开回到默认列表。`hitsQuery` 是产生当前 hits 的那次
// query（后台回带），点结果跳转时用它而不是输入框里可能已改动的文字。

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionSearchChannel } from '@/lib/agent/session-search-channel';
import type { SessionSearchHit } from '@/lib/ipc/protocol';

const DEBOUNCE_MS = 250;

export function useSessionSearch(open: boolean) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SessionSearchHit[]>([]);
  const [hitsQuery, setHitsQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 世代号：每次按键 / 清空都自增，回包时比对，过期结果直接丢。
  const seq = useRef(0);
  const timer = useRef<number>(0);
  // 最近一次真正要搜的 query（trim 后），refresh 用。
  const pendingQuery = useRef('');

  const runSearch = useCallback((q: string, mySeq: number) => {
    sessionSearchChannel
      .search(q)
      .then(({ hits: h, query: q2 }) => {
        if (seq.current !== mySeq) return;
        setHits(h);
        setHitsQuery(q2);
        setError(null);
        setSearching(false);
      })
      .catch((err: Error) => {
        if (seq.current !== mySeq) return;
        setHits([]);
        setHitsQuery('');
        setError(err.message);
        setSearching(false);
      });
  }, []);

  const clear = useCallback(() => {
    seq.current++;
    window.clearTimeout(timer.current);
    pendingQuery.current = '';
    setQuery('');
    setHits([]);
    setHitsQuery('');
    setSearching(false);
    setError(null);
  }, []);

  /** 输入框 onChange：存 query，立刻进入「搜索中」，debounce 后真正发请求。 */
  const onQueryChange = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      const mySeq = ++seq.current;
      window.clearTimeout(timer.current);
      setQuery(q);
      pendingQuery.current = trimmed;
      if (!trimmed) {
        setHits([]);
        setHitsQuery('');
        setSearching(false);
        setError(null);
        return;
      }
      setSearching(true);
      setError(null);
      timer.current = window.setTimeout(() => runSearch(trimmed, mySeq), DEBOUNCE_MS);
    },
    [runSearch],
  );

  /** 会话列表变了（删除 / 改名）时静默重跑当前查询：不进入「搜索中」，旧结果留到新结果到达。 */
  const refresh = useCallback(() => {
    const q = pendingQuery.current;
    if (!q) return;
    window.clearTimeout(timer.current);
    runSearch(q, ++seq.current);
  }, [runSearch]);

  useEffect(() => {
    if (!open) clear();
  }, [open, clear]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    query,
    hits,
    hitsQuery,
    searching,
    error,
    /** query 非空 = 显示搜索结果区（含搜索中 / 出错 / 无结果状态）而非默认分组列表。 */
    active: query.trim().length > 0,
    onQueryChange,
    clear,
    refresh,
  };
}
