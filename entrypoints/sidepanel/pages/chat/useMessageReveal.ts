// 历史搜索跳转（issue #101）：从搜索结果打开会话时，App 把 `{ messageIndex, query }`
// 放进路由 state；会话消息渲染出来后，这里把视口滚到那条消息、短暂描边，并用
// CSS Custom Highlight API 标出查询词（不支持时只滚动 + 描边）。
//
// 定位口径：聊天页每条消息外包一层 `data-message-index={idx}`（idx = messages 数组
// 下标），与后台搜索给出的 messageIndex 同源（都是 main 分支 projectEntries 的下标）。
// 搜索之后会话若又变了（新消息 / 切分支），下标处的消息不含查询词时退回按文本找
// 第一条含词的消息；都找不到就只打开会话、不滚动。

import { useEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import type { MessageReveal } from '@/components/layout/HistoryPanel';

const HIGHLIGHT_NAME = 'cebian-search-match';
const REVEAL_CLASS = 'animate-message-reveal';
const REVEAL_MS = 2400;

function readReveal(state: unknown): MessageReveal | undefined {
  const r = (state as { reveal?: Partial<MessageReveal> } | null)?.reveal;
  if (!r || typeof r.messageIndex !== 'number' || typeof r.query !== 'string' || !r.query.trim()) {
    return undefined;
  }
  return { messageIndex: r.messageIndex, query: r.query };
}

/** 找要跳到的消息槽（`display: contents` 的包裹层）。 */
function findSlot(root: HTMLElement, reveal: MessageReveal, needle: string): HTMLElement | null {
  const exact = root.querySelector<HTMLElement>(`[data-message-index="${reveal.messageIndex}"]`);
  if (exact && exact.textContent?.toLowerCase().includes(needle)) return exact;
  for (const slot of root.querySelectorAll<HTMLElement>('[data-message-index]')) {
    if (slot.textContent?.toLowerCase().includes(needle)) return slot;
  }
  return exact;
}

/** 手动算 scrollTop 而不用 scrollIntoView：后者会连带滚动 overflow-hidden 的外层容器（#91）。 */
function scrollIntoViewport(viewport: HTMLElement, el: HTMLElement): void {
  const vp = viewport.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const offset = box.height < vp.height ? (vp.height - box.height) / 2 : 16;
  viewport.scrollTop += box.top - vp.top - offset;
}

/** 在消息内的文本节点里标出查询词（只匹配单个文本节点内的出现）；API 不可用时什么都不做。 */
function markQuery(container: HTMLElement, needle: string): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? '';
    const lower = text.toLowerCase();
    // toLowerCase 改变了长度（极少数字符）时下标不可信，跳过该节点
    if (lower.length !== text.length) continue;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  if (ranges.length > 0) CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges));
}

function clearQueryMarks(): void {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT_NAME);
}

/**
 * @param scrollRef 聊天区 ScrollArea 的根节点
 * @param unpin     停止「贴底跟随」（useStickToBottom 提供）
 * @param ready     当前路由的会话消息已渲染（非加载中且非空）
 */
function useMessageReveal(
  scrollRef: RefObject<HTMLElement | null>,
  unpin: () => void,
  ready: boolean,
): void {
  const location = useLocation();
  // 同一次导航只跳一次：之后消息流式增长不应反复把视口拽回来。
  const handledKey = useRef<string | null>(null);

  useEffect(() => {
    const reveal = readReveal(location.state);
    if (!reveal || !ready || handledKey.current === location.key) return;
    unpin();

    let revealed: HTMLElement | null = null;
    let timer = 0;
    // 等本帧布局完成（含刚挂上的消息 DOM）再测量
    // handledKey 在帧回调里才记：StrictMode 下首轮 effect 的帧会被 cleanup 取消，
    // 若提前记下，第二轮会直接 return，跳转就丢了。
    const frame = requestAnimationFrame(() => {
      handledKey.current = location.key;
      const root = scrollRef.current;
      const viewport = root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (!root || !viewport) return;
      const needle = reveal.query.trim().replace(/\s+/g, ' ').toLowerCase();
      const slot = findSlot(root, reveal, needle);
      const el = slot?.firstElementChild as HTMLElement | null | undefined;
      if (!slot || !el) return;
      scrollIntoViewport(viewport, el);
      el.classList.add(REVEAL_CLASS);
      revealed = el;
      timer = window.setTimeout(() => el.classList.remove(REVEAL_CLASS), REVEAL_MS);
      markQuery(slot, needle);
    });

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      revealed?.classList.remove(REVEAL_CLASS);
      clearQueryMarks();
    };
  }, [location.key, location.state, ready, scrollRef, unpin]);
}

// ─── Public API ───

export { useMessageReveal };
