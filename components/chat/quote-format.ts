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

export { appendQuoteToDraft };
