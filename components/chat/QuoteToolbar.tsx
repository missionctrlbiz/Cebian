// 划词引用工具条（issue #103）：在对话区里选中消息正文时浮出「引用」按钮，把选中文本
// 以引注块追加进输入框。内容脚本里的 SelectionToolbar 管的是网页文本，这里只处理侧边栏
// 自己的消息区。可引用的正文由 Message.tsx 用 data-quote-source 标出（值为角色）。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Quote, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';

type QuoteSource = 'user' | 'assistant';

/** 选区锚点：选中文本、出处，以及首末行矩形（相对 wrapper 的坐标）。 */
interface Anchor {
  text: string;
  /** 选区只落在一条消息正文内时为该消息角色；跨消息时为 null（不加出处行）。 */
  source: QuoteSource | null;
  first: { top: number; centerX: number };
  last: { bottom: number; centerX: number };
}

interface Position {
  left: number;
  top: number;
}

interface QuoteToolbarProps {
  /** 消息列表根节点（ScrollArea 内容区）：选区必须落在它内部。 */
  root: HTMLElement | null;
  /** 工具条的定位参考框（不随滚动位移的外层容器，需 position: relative）。 */
  wrapper: HTMLElement | null;
  /** 点「引用」：传出选中文本与可选出处行（已本地化，如「Assistant:」）。 */
  onQuote: (text: string, attribution?: string) => void;
}

const SOURCE_SELECTOR = '[data-quote-source]';
// 选区端点落在这些控件里时不弹出：输入框、按钮、可编辑区等不是「消息正文」。
const CONTROL_SELECTOR =
  'input, textarea, select, button, [role="button"], [contenteditable]:not([contenteditable="false"])';
const SELECTION_DEBOUNCE_MS = 150;
const GAP = 6;
const EDGE = 4;

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function readSource(el: Element): QuoteSource | null {
  const value = el.getAttribute('data-quote-source');
  return value === 'user' || value === 'assistant' ? value : null;
}

/**
 * 读取当前选区并判定是否可引用：必须非空、在 root 内、端点不在控件里，且至少覆盖一段
 * 消息正文（工具卡片、权限卡片等单独选中时不弹出）。坐标换算成相对 wrapper。
 */
function readAnchor(root: HTMLElement, wrapper: HTMLElement): Anchor | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  for (const node of [range.startContainer, range.endContainer]) {
    if (elementOf(node)?.closest(CONTROL_SELECTOR)) return null;
  }
  const text = selection.toString();
  if (!text.trim()) return null;

  const sources = Array.from(root.querySelectorAll(SOURCE_SELECTOR)).filter((el) => range.intersectsNode(el));
  if (sources.length === 0) return null;
  // 只覆盖一段正文时，还要确认选区没溢出到它外面（比如带上了旁边的工具卡片）才标出处
  const single = sources.length === 1 ? sources[0] : null;
  const contained = single
    && single.contains(range.startContainer)
    && single.contains(range.endContainer);
  const source = contained ? readSource(single) : null;

  // 首末行矩形：滤掉三击选段时末尾的零宽矩形，否则对齐会偏到没选中的位置
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
  const firstRect = rects[0] ?? range.getBoundingClientRect();
  const lastRect = rects[rects.length - 1] ?? firstRect;
  if (firstRect.width === 0 && firstRect.height === 0) return null;
  const box = wrapper.getBoundingClientRect();
  return {
    text,
    source,
    first: { top: firstRect.top - box.top, centerX: firstRect.left - box.left + firstRect.width / 2 },
    last: { bottom: lastRect.bottom - box.top, centerX: lastRect.left - box.left + lastRect.width / 2 },
  };
}

/** 按实测尺寸摆放：优先放在首行上方，放不下就放在末行下方，并夹在 wrapper 内。 */
function placeToolbar(anchor: Anchor, width: number, height: number, wrapper: HTMLElement): Position {
  const clampX = (x: number) => Math.max(EDGE, Math.min(x - width / 2, wrapper.clientWidth - width - EDGE));
  const above = anchor.first.top - GAP - height;
  if (above >= EDGE) return { left: clampX(anchor.first.centerX), top: above };
  const below = Math.min(anchor.last.bottom + GAP, wrapper.clientHeight - height - EDGE);
  return { left: clampX(anchor.last.centerX), top: Math.max(EDGE, below) };
}

function QuoteToolbar({ root, wrapper, onQuote }: QuoteToolbarProps) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 选区监听：拖选进行中只隐藏，松开后再显示；键盘改选区走去抖；选区收起立刻隐藏
  useEffect(() => {
    if (!root || !wrapper) return;
    let timer: number | undefined;
    let pointerDown = false;
    const clearTimer = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const show = () => {
      clearTimer();
      setAnchor(readAnchor(root, wrapper));
    };
    const hide = () => {
      clearTimer();
      setAnchor(null);
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        hide();
        return;
      }
      if (pointerDown) return;
      clearTimer();
      timer = window.setTimeout(show, SELECTION_DEBOUNCE_MS);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      pointerDown = true;
      hide();
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      // 等浏览器结算完选区（双击 / 三击选词选段）再读
      clearTimer();
      timer = window.setTimeout(show, 0);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    root.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimer();
      document.removeEventListener('selectionchange', onSelectionChange);
      root.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [root, wrapper]);

  // 消息区滚动 / 窗口尺寸变化会让锚点坐标失效：直接收起，不追着飘
  useEffect(() => {
    if (!anchor || !wrapper) return;
    const viewport = wrapper.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const hide = () => setAnchor(null);
    viewport?.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', hide);
    return () => {
      viewport?.removeEventListener('scroll', hide);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, wrapper]);

  // 用渲染后的实际尺寸定位（文案长度随语言变化），首帧测量前先隐藏避免闪到左上角
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!anchor || !wrapper || !bar) {
      setPos(null);
      return;
    }
    setPos(placeToolbar(anchor, bar.offsetWidth, bar.offsetHeight, wrapper));
  }, [anchor, wrapper]);

  if (!wrapper || !anchor) return null;

  const handleQuote = () => {
    const attribution = anchor.source === 'user'
      ? t('chat.message.quoteFromUser')
      : anchor.source === 'assistant'
        ? t('chat.message.quoteFromAssistant')
        : undefined;
    onQuote(anchor.text, attribution);
    setAnchor(null);
  };

  return (
    <div
      ref={barRef}
      role="toolbar"
      aria-label={t('chat.message.quote')}
      className="absolute z-30 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-0.5 text-popover-foreground shadow-md"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      // 按下工具条不清空消息区里的选区
      onMouseDown={(e) => e.preventDefault()}
    >
      <Button variant="ghost" size="xs" onClick={handleQuote}>
        <Quote />
        {t('chat.message.quote')}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        onClick={() => setAnchor(null)}
        title={t('chat.message.quoteDismiss')}
        aria-label={t('chat.message.quoteDismiss')}
      >
        <X />
      </Button>
    </div>
  );
}

export { QuoteToolbar };
