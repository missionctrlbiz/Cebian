// 会话关键词搜索的响应式包装（issue #101）：HistoryPanel 的搜索框用它。
//
// 每次按键 debounce 250ms 后发一次 `session_search`；后台按 requestId 回包，
// 这里只收「最后一次在途」的结果，更早的请求落空就丢弃（stale guard）。
// 出错（端口断 / 后台异常）置 error，输入框不变，用户重敲即重发。

import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionSearchChannel } from '@/lib/agent/session-search-channel';
import type { SessionSearchHit, SessionSearchScope } from '@/lib/ipc/protocol';

const DEBOUNCE_MS = 250;

export function useSessionSearch(enabled: boolean) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SessionSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 世代号：每次新请求自增，回包前比对，过期结果直接丢。
  const seq = useRef(0);
  const timer = useRef<number>(0);

  // 输入框是 HistoryPanel 本地状态，这里只暴露 query + 结果 + 触发；
  // debounce 在这里跑，面板只管把 query 传进来。
  const runSearch = useCallback((q: string, scope?: SessionSearchScope) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setHits([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    setError(null);
    const mySeq = ++seq.current;
    sessionSearchChannel
      .search(trimmed, scope)
      .then(({ hits: h }) => {
        if (seq.current !== mySeq) return;
        setHits(h);
        setSearching(false);
      })
      .catch((err: Error) => {
        if (seq.current !== mySeq) return;
        setError(err.message);
        setSearching(false);
      });
  }, []);

  /** 面板的输入框 onChange：只存 query + debounce 触发。 */
  const onQueryChange = useCallback(
    (q: string, scope?: SessionSearchScope) => {
      setQuery(q);
      window.clearTimeout(timer.current);
      if (!q.trim()) {
        setHits([]);
        setSearching(false);
        setError(null);
        return;
      }
      timer.current = window.setTimeout(() => runSearch(q, scope), DEBOUNCE_MS);
    },
    [runSearch],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    query,
    hits,
    searching,
    error,
    /** 是否有活跃搜索（query 非空且未出错）——驱动「显示结果列表」而非「默认分组列表」。 */
    active: query.trim().length > 0 && !error,
    onQueryChange,
    clear: () => {
      setQuery('');
      setHits([]);
      setSearching(false);
      setError(null);
      window.clearTimeout(timer.current);
    },
  };
}
