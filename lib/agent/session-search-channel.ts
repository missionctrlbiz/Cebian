// 会话关键词搜索的 UX 侧通道（issue #101）。
//
// 与 lib/agent/session-list-channel.ts 的差别：搜索是**请求 / 响应**对（可以并发
// 多条——用户快敲 / 多窗口），而 session_list 只能串行（响应无请求 id）。所以这里
// 学 lib/mcp/sidepanel-channel.ts 的 requestId 配对法：每次请求客户端自生成 id，
// pending Map 里挂 resolve/reject，后台把同一 id 原样带回时命中。
//
// 端口仍由 useBackgroundAgent 持有（同 session-list-channel 的约定），本模块只
// 存 portRef + pending，不另开连接。

import { uuidv7 } from '@earendil-works/pi-ai';
import type {
  ClientMessage,
  SessionSearchHit,
  SessionSearchScope,
} from '@/lib/ipc/protocol';

export interface SessionSearchResult {
  hits: SessionSearchHit[];
}

type Pending = {
  resolve: (r: SessionSearchResult) => void;
  reject: (err: Error) => void;
  /** 响应里的 requestId，与请求同值。 */
  requestId: string;
};

let portRef: chrome.runtime.Port | null = null;
const pending = new Map<string, Pending>();

/** 后台回了一条搜索响应（`useBackgroundAgent` 的 handleMessage 调它）。 */
function settle(requestId: string, ok: boolean, payload?: SessionSearchResult, error?: string): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  if (ok && payload) entry.resolve(payload);
  else entry.reject(new Error(error ?? 'search failed'));
}

export const sessionSearchChannel = {
  setPort(p: chrome.runtime.Port | null): void {
    portRef = p;
    // 断连（含换端口）：所有在途搜索不可能再回来了，全部 reject 掉，
    // 免得调用方的 promise 永久悬挂。
    if (p === null) {
      for (const entry of pending.values()) {
        entry.reject(new Error('search aborted: port disconnected'));
      }
      pending.clear();
    }
  },

  /** 后台广播 `session_search_result` 时由 hook 调进来。 */
  publishResult(requestId: string, hits: SessionSearchHit[], _query: string): void {
    settle(requestId, true, { hits });
  },

  /** 后台广播 `session_search_error` 时由 hook 调进来。 */
  publishError(requestId: string, error: string): void {
    settle(requestId, false, undefined, error);
  },

  /**
   * 发一次搜索。返回的 promise 在对应响应到达时 resolve；请求已发出但响应永远
   * 不会来的唯一情形是端口断连（那会 reject，见 setPort(null)）。
   * 返回 false 表示此刻没有端口（SW 未连），promise 永不 resolve——调用方应改查
   * `isConnected()` 或先 await 连接。
   */
  search(query: string, scope: SessionSearchScope = {}): Promise<SessionSearchResult> {
    const requestId = uuidv7();
    const promise = new Promise<SessionSearchResult>((resolve, reject) => {
      pending.set(requestId, { resolve, reject, requestId });
    });
    const msg: ClientMessage = { type: 'session_search', query, requestId, ...scope };
    if (!portRef) {
      pending.delete(requestId);
      promise.catch(() => undefined);
      return Promise.reject(new Error('search unavailable: port not connected'));
    }
    try {
      portRef.postMessage(msg);
    } catch (err) {
      pending.delete(requestId);
      console.warn('[sessionSearchChannel] postMessage failed:', err);
      portRef = null;
      return Promise.reject(new Error('search request failed to send'));
    }
    return promise;
  },
};
