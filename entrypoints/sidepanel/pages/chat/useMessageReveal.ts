// 历史搜索跳转（issue #101）：从搜索结果打开会话时，App 把 `{ messageIndex, query }`
// 放进路由 state；会话消息渲染出来后，这里把视口滚到那条消息、短暂描边，并用
// CSS Custom Highlight API 标出查询词（不支持时只滚动 + 描边）。
//
// 定位口径：聊天页每条消息外包一层 `data-message-index={idx}`（idx = messages 数组
// 下标），与后台搜索给出的 messageIndex 同源（都是 main 分支 projectEntries 的下标）。
// 搜索之后会话若又变了（新消息 / 切分支），下标处的消息不含查询词时，从该下标向两侧
// 由近及远找含词的消息；都找不到就只打开会话、不滚动。跳转处理完即从路由 state 里
// 清掉目标（replace，不重载会话），前进 / 后退回到这一项时不会再跳一次。

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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

/** 与后台建索引同一口径：空白归一 + 小写。 */
function normalizeText(text: string | null): string {
  return (text ?? '').replace(/\s+/g, ' ').toLowerCase();
}

/** 找要跳到的消息槽（`display: contents` 的包裹层）：优先 messageIndex 处，不含查询词时
 *  取离它最近的含词消息；都不含则仍返回下标处的槽（可能为 null）。 */
function findSlot(root: HTMLElement, reveal: MessageReveal, needle: string): HTMLElement | null {
  const exact = root.querySelector<HTMLElement>(`[data-message-index="${reveal.messageIndex}"]`);
  if (exact && normalizeText(exact.textContent).includes(needle)) return exact;
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const slot of root.querySelectorAll<HTMLElement>('[data-message-index]')) {
    const distance = Math.abs(Number(slot.dataset.messageIndex) - reveal.messageIndex);
    if (distance < bestDistance && normalizeText(slot.textContent).includes(needle)) {
      best = slot;
      bestDistance = distance;
    }
  }
  return best ?? exact;
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
  const navigate = useNavigate();
  // 当前生效的描边（及其撤除定时器）。不挂在主 effect 的 cleanup 上：处理完会 replace
  // 掉路由 state，那次 location 变化不该把刚加上的描边 / 高亮清掉。
  const active = useRef<{ el: HTMLElement; timer: number } | null>(null);

  const dispose = useCallback(() => {
    if (active.current) {
      window.clearTimeout(active.current.timer);
      active.current.el.classList.remove(REVEAL_CLASS);
      active.current = null;
    }
    clearQueryMarks();
  }, []);

  // 卸载、或切走 / 重新加载会话时撤掉描边与高亮。
  useEffect(() => dispose, [dispose]);
  useEffect(() => {
    if (!ready) dispose();
  }, [ready, dispose]);

  useEffect(() => {
    const reveal = readReveal(location.state);
    if (!reveal || !ready) return;
    const path = location.pathname;
    // 等本帧布局完成（含刚挂上的消息 DOM）再测量。StrictMode 下首轮的帧会被 cleanup
    // 取消，第二轮照常执行。
    const frame = requestAnimationFrame(() => {
      // 先清掉路由里的目标：前进 / 后退回到这一项时不再重复跳转
      navigate(path, { replace: true, state: null });
      dispose();
      const root = scrollRef.current;
      const viewport = root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
      if (!root || !viewport) return;
      const needle = normalizeText(reveal.query.trim());
      const slot = findSlot(root, reveal, needle);
      const el = slot?.firstElementChild as HTMLElement | null | undefined;
      if (!slot || !el) return;
      // 找到目标才停止贴底跟随，否则保持原有的贴底行为
      unpin();
      scrollIntoViewport(viewport, el);
      el.classList.add(REVEAL_CLASS);
      active.current = {
        el,
        timer: window.setTimeout(() => el.classList.remove(REVEAL_CLASS), REVEAL_MS),
      };
      markQuery(slot, needle);
    });
    return () => cancelAnimationFrame(frame);
  }, [location.state, location.pathname, ready, scrollRef, unpin, navigate, dispose]);
}

// ─── Public API ───

export { useMessageReveal };
