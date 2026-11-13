// 划词引用（issue #103）的纯文本拼装：把对话里选中、按消息切好的文本整理成
// 发给模型的上下文块、芯片上的摘要，以及「复制」用的纯文本。纯函数、无 DOM，单测覆盖。

/** 选区落在某一段消息正文内的那一截文本，及其出处行（已本地化，如「Assistant:」）。 */
interface QuotePiece {
  text: string;
  attribution?: string;
}

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
 * 相邻且出处相同的几截（如同一轮里被工具卡片隔开的几段回复）用空行合并成一块，
 * 避免重复的出处行；空白的截被跳过。不改动入参。
 */
function mergePieces(pieces: readonly QuotePiece[]): QuotePiece[] {
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
  return merged;
}

/**
 * 把引用件渲染成「发给模型的上下文」文本。
 * 刻意用**朴素文本**而非 markdown：模型读到 `> **` 这类装饰会当成内容噪声，
 * 出处行写成 `From <角色>:`（角色名保持本地化），正文原样、不加引注前缀。
 */
function quoteBlocks(pieces: readonly QuotePiece[]): string {
  const blocks: string[] = [];
  for (const piece of mergePieces(pieces)) {
    const body = normalizeQuoteText(piece.text);
    if (!body) continue;
    const label = piece.attribution?.trim();
    // 出处行用 "From <label>"（label 本身已含冒号，如 "Assistant:"）；无出处则裸正文。
    blocks.push(label ? `From ${label}\n${body}` : body);
  }
  return blocks.join('\n\n');
}

/** 「复制」用的纯文本：只有选中的正文（整理换行），不带出处行——剪贴板里就是用户看到的字。 */
function quoteCopyText(pieces: readonly QuotePiece[]): string {
  return mergePieces(pieces)
    .map((piece) => normalizeQuoteText(piece.text))
    .filter(Boolean)
    .join('\n\n');
}

/** 发送时用的载荷：引注块在前，用户自己敲的正文在后（空行隔开）；引用或正文缺时任取其一。 */
function composeOutgoingMessage(draft: string, pieces: readonly QuotePiece[]): string {
  const block = quoteBlocks(pieces);
  const typed = draft.trim();
  if (block && typed) return `${block}\n\n${typed}`;
  return block || typed;
}

/** 芯片上的单行摘要：第一行 + 截断，带出处前缀（没有出处就裸文本）。 */
function quoteChipLabel(pieces: readonly QuotePiece[]): string {
  const first = pieces.find((p) => p.text.trim());
  if (!first) return '';
  const label = first.attribution?.trim();
  const line = first.text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const short = line.length > 40 ? `${line.slice(0, 40)}…` : line;
  return label ? `${label} ${short}` : short;
}

export type { QuotePiece };
export { composeOutgoingMessage, quoteBlocks, quoteChipLabel, quoteCopyText };
