// 划词引用（issue #103）的纯文本拼装：把对话里选中的文字整理成 markdown 引注块，
// 并接到输入框草稿后面。纯函数、无 DOM，供 ChatInput 使用并单测覆盖。

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
 * 把选中文本拼成引注块并追加到草稿末尾，返回新草稿（光标应放在其末尾）。
 *
 * - 每行加 `> ` 前缀，空行写成 `>`，保持引注块连续不断开；
 * - `attribution` 非空时在块首加一行加粗出处（如 `> **Assistant:**`）；
 * - 草稿已有内容时与引注块之间空一行；只有空白的草稿视为空；
 * - 块后补一个空行，用户接着在引注块下方输入。
 *
 * 选中文本整理后为空时原样返回草稿。
 */
function appendQuoteToDraft(draft: string, text: string, attribution?: string): string {
  const body = normalizeQuoteText(text);
  if (!body) return draft;
  const lines = body.split('\n').map((line) => (line ? `> ${line}` : '>'));
  const label = attribution?.trim();
  if (label) lines.unshift(`> **${label}**`);
  const block = `${lines.join('\n')}\n\n`;
  const head = draft.trimEnd();
  return head ? `${head}\n\n${block}` : block;
}

/** 选区落在某一段消息正文内的那一截文本，及其出处行（已本地化，如「Assistant:」）。 */
interface QuotePiece {
  text: string;
  attribution?: string;
}

/**
 * 把按消息切好的多截选中文本依次追加成引注块：相邻且出处相同的几截（如同一轮里
 * 被工具卡片隔开的几段回复）先用空行合并成一块，避免重复的出处行；空白的截被跳过。
 */
function appendQuotePiecesToDraft(draft: string, pieces: readonly QuotePiece[]): string {
  const merged: QuotePiece[] = [];
  for (const piece of pieces) {
    if (!piece.text.trim()) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.attribution === piece.attribution) {
      prev.text = `${prev.text}\n\n${piece.text}`;
    } else {
      merged.push({ ...piece });
    }
  }
  return merged.reduce((acc, piece) => appendQuoteToDraft(acc, piece.text, piece.attribution), draft);
}

export type { QuotePiece };
export { appendQuoteToDraft, appendQuotePiecesToDraft };
