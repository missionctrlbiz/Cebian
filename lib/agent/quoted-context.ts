// 划词引用（issue #103）在 user 消息里的载体：引用段落以 `<quoted-context>` 块写在
// `<user-request>` 内文的开头，用户自己敲的话跟在后面。
//
// 产出（侧边栏 ChatInput 发送时）与解析（message-helpers 给气泡 / 编辑 / ↑ 历史取文本）
// 共用本模块，保证两侧逐字节同形。块内是可信的用户选择（来自本扩展自己渲染的消息正文），
// 不是页面来源文本，因此不进 prompt-envelope 的外层标签清单。
//
// 模型看到的是带出处属性的结构块（`source="assistant"`），比「From Assistant:」这类
// 口语行更不易与正文混淆；气泡里则把块渲染成引用样式，不露出标签与出处行。

type QuoteSource = 'user' | 'assistant';

/** 一段被引用的消息正文及其出处（选区跨消息时一次选择会产出多段）。 */
interface QuotedContext {
  text: string;
  source?: QuoteSource;
}

const TAG = 'quoted-context';
// 块形状：`<quoted-context source="assistant">\n正文\n</quoted-context>`；source 可缺省。
const BLOCK_RE = /^<quoted-context(?: source="(user|assistant)")?>\n([\s\S]*?)\n<\/quoted-context>/;
// 正文里若出现同名标签会提前闭合块：写入时把 `<` 转成实体，解析时还原。
const ESCAPE_RE = /<(\/?)quoted-context/gi;
const UNESCAPE_RE = /&lt;(\/?)quoted-context/gi;

/** 整理选中文本：统一换行、去掉每行行尾空白与首尾空行、把连续多个空行压成一个。 */
function normalizeQuoteText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * 整理并合并引用段：正文规整后为空的段跳过；相邻且出处相同的段（如同一轮里被工具卡片
 * 隔开的几段回复）用空行合并成一段。不改动入参。
 */
function mergeQuotes(quotes: readonly QuotedContext[]): QuotedContext[] {
  const merged: QuotedContext[] = [];
  for (const quote of quotes) {
    const text = normalizeQuoteText(quote.text);
    if (!text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.source === quote.source) {
      prev.text = `${prev.text}\n\n${text}`;
    } else {
      merged.push(quote.source ? { text, source: quote.source } : { text });
    }
  }
  return merged;
}

function buildBlock(quote: QuotedContext): string {
  const attr = quote.source ? ` source="${quote.source}"` : '';
  return `<${TAG}${attr}>\n${quote.text.replace(ESCAPE_RE, '&lt;$1quoted-context')}\n</${TAG}>`;
}

/**
 * 发送时 `<user-request>` 的内文：引用块在前、用户敲的话在后（空行隔开）；缺一则取另一。
 * 没有有效引用时原样返回去掉首尾空白的正文。
 */
function composeQuotedRequest(quotes: readonly QuotedContext[], typed: string): string {
  const blocks = mergeQuotes(quotes).map(buildBlock).join('\n\n');
  const text = typed.trim();
  if (blocks && text) return `${blocks}\n\n${text}`;
  return blocks || text;
}

/** 从 `<user-request>` 内文里拆出开头的引用块与其后用户自己的话；无引用块时 quotes 为空。 */
function splitQuotedRequest(request: string): { quotes: QuotedContext[]; text: string } {
  const quotes: QuotedContext[] = [];
  let rest = request.replace(/^\s+/, '');
  for (let m = BLOCK_RE.exec(rest); m; m = BLOCK_RE.exec(rest)) {
    const text = m[2].replace(UNESCAPE_RE, '<$1quoted-context');
    quotes.push(m[1] ? { text, source: m[1] as QuoteSource } : { text });
    rest = rest.slice(m[0].length).replace(/^\s+/, '');
  }
  return { quotes, text: quotes.length > 0 ? rest.trim() : request.trim() };
}

// ─── 公开 API ───

export type { QuoteSource, QuotedContext };
export { composeQuotedRequest, mergeQuotes, splitQuotedRequest };
