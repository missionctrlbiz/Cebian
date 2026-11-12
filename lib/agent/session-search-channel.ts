// 会话关键词搜索的 UX 侧通道（issue #101）。
//
// 与 lib/agent/session-list-channel.ts 的差别：搜索是**请求 / 响应**对（可以并发
// 多条——用户快敲 / 多窗口），而 session_list 只能串行（响应无请求 id）。所以这里
// 学 lib/mcp/sidepanel-channel.ts 的 requestId 配对法：每次请求客户端自生成 id，
// pending Map 里挂 resolve/reject，后台把同一 id 原样回到发起端口时命中。
//
// 端口仍由 useBackgroundAgent 持有（同 session-list-channel 的约定），本模块只
// 存 portRef + pending，不另开连接。

import { uuidv7 } from '@earendil-works/pi-ai';
import type { ClientMessage, SessionSearchHit } from '@/lib/ipc/protocol';

/** 一次搜索的结果：命中列表 + 产生它的 query（后台原样回带）。 */
interface SearchReply {
  hits: SessionSearchHit[];
  query: string;
}

interface Pending {
  resolve: (reply: SearchReply) => void;
  reject: (err: Error) => void;
}

let portRef: chrome.runtime.Port | null = null;
const pending = new Map<string, Pending>();

function takePending(requestId: string): Pending | undefined {
  const entry = pending.get(requestId);
  if (entry) pending.delete(requestId);
  return entry;
}

const sessionSearchChannel = {
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

  /** 后台在本端口回了 `session_search_result`（`useBackgroundAgent` 的 handleMessage 调它）。 */
  publishResult(requestId: string, hits: SessionSearchHit[], query: string): void {
    takePending(requestId)?.resolve({ hits, query });
  },

  /** 后台在本端口回了 `session_search_error`。 */
  publishError(requestId: string, error: string): void {
    takePending(requestId)?.reject(new Error(error || 'search failed'));
  },

  /**
   * 发一次搜索。promise 在对应回包到达时 resolve / reject；端口未连或发送失败立即
   * reject，端口中途断开时由 setPort(null) reject——不会永久悬挂。
   */
  search(query: string): Promise<SearchReply> {
    const port = portRef;
    if (!port) return Promise.reject(new Error('search unavailable: port not connected'));
    const requestId = uuidv7();
    const msg: ClientMessage = { type: 'session_search', query, requestId };
    return new Promise<SearchReply>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        port.postMessage(msg);
      } catch (err) {
        pending.delete(requestId);
        console.warn('[sessionSearchChannel] postMessage failed:', err);
        portRef = null;
        reject(new Error('search request failed to send'));
      }
    });
  },
};

// ─── Public API ───

export { sessionSearchChannel };
