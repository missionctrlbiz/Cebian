// 划词引用（issue #103）在输入框一侧的纯文本小工具：「复制」用的纯文本、引用芯片上的
// 摘要（只有文字，不带出处）、芯片去重键。发给模型的块由 lib/agent/quoted-context 负责。纯函数、无 DOM。
import { mergeQuotes, type QuotedContext } from '@/lib/agent/quoted-context';

const CHIP_LABEL_MAX = 40;

/** 「复制」用的纯文本：只有选中的正文（整理换行），不带出处——剪贴板里就是用户看到的字。 */
function quoteCopyText(quotes: readonly QuotedContext[]): string {
  return mergeQuotes(quotes).map((q) => q.text).join('\n\n');
}

/** 芯片上的单行摘要：首段第一行 + 截断，只显示引用的文字本身（不带出处前缀）。 */
function quoteChipLabel(quotes: readonly QuotedContext[]): string {
  const first = mergeQuotes(quotes)[0];
  if (!first) return '';
  const line = first.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > CHIP_LABEL_MAX ? `${line.slice(0, CHIP_LABEL_MAX)}…` : line;
}

/** 芯片去重键：同一段内容（规整后）重复「加入聊天」只保留一枚芯片。 */
function quoteKey(quotes: readonly QuotedContext[]): string {
  return JSON.stringify(mergeQuotes(quotes));
}

export { quoteChipLabel, quoteCopyText, quoteKey };
