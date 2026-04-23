export type GemmaBlockType = "text" | "think" | "execute_tool";

export interface GemmaContentBlock {
  type: GemmaBlockType;
  content: string;
  toolName?: string;
  toolArgs?: Record<string, string>;
  parsed?: boolean;
  isOpen?: boolean;
}

export interface GemmaStreamPreprocessResult {
  normalizedContent: string;
  hasOpenThink: boolean;
  hasOpenExecuteTool: boolean;
}

const CONTROL_TOKEN_PATTERN = /<\|tool_call\|>|<tool_call\|>|<channel\|>/g;

const stripControlTokens = (value: string) => value.replace(CONTROL_TOKEN_PATTERN, "");

const normalizeVisibleText = (value: string) => stripControlTokens(value).replace(/\r\n/g, "\n");

const sanitizeGemmaValue = (value: string): string =>
  value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .trim();

const countTag = (value: string, tag: string) => (value.match(new RegExp(tag, "g")) ?? []).length;

export const preprocessGemmaStream = (content: string): GemmaStreamPreprocessResult => {
  const normalized = normalizeVisibleText(content);
  const thinkOpenCount = countTag(normalized, "<think>");
  const thinkCloseCount = countTag(normalized, "</think>");
  const executeOpenCount = countTag(normalized, "<execute_tool>");
  const executeCloseCount = countTag(normalized, "</execute_tool>");

  const hasOpenThink = thinkOpenCount > thinkCloseCount;
  const hasOpenExecuteTool = executeOpenCount > executeCloseCount;

  const normalizedContent =
    normalized +
    (hasOpenThink ? "</think>" : "") +
    (hasOpenExecuteTool ? "</execute_tool>" : "");

  return {
    normalizedContent,
    hasOpenThink,
    hasOpenExecuteTool,
  };
};

const findNextTag = (value: string): { tagName: "think" | "execute_tool"; index: number } | null => {
  const thinkIndex = value.indexOf("<think>");
  const executeToolIndex = value.indexOf("<execute_tool>");

  if (thinkIndex === -1 && executeToolIndex === -1) {
    return null;
  }

  if (thinkIndex === -1) {
    return { tagName: "execute_tool", index: executeToolIndex };
  }

  if (executeToolIndex === -1 || thinkIndex < executeToolIndex) {
    return { tagName: "think", index: thinkIndex };
  }

  return { tagName: "execute_tool", index: executeToolIndex };
};

const extractGemmaArguments = (rawArguments: string): Record<string, string> => {
  const normalizedArguments = sanitizeGemmaValue(stripControlTokens(rawArguments));
  if (!normalizedArguments) {
    return {};
  }

  const extractedArguments: Record<string, string> = {};
  const quotedValuePattern = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*<\|"\|>([\s\S]*?)<\|"\|>/g;
  for (const match of normalizedArguments.matchAll(quotedValuePattern)) {
    const key = match[1]?.trim();
    if (!key) {
      continue;
    }
    extractedArguments[key] = sanitizeGemmaValue(match[2] ?? "");
  }

  if (Object.keys(extractedArguments).length > 0) {
    return extractedArguments;
  }

  const jsonLikeArguments = normalizedArguments
    .replace(/<\|"\|>/g, '"')
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');

  try {
    const parsedArguments = JSON.parse(jsonLikeArguments);
    if (parsedArguments && typeof parsedArguments === "object" && !Array.isArray(parsedArguments)) {
      return Object.fromEntries(
        Object.entries(parsedArguments).map(([key, value]) => [
          key,
          typeof value === "string" ? sanitizeGemmaValue(value) : sanitizeGemmaValue(JSON.stringify(value)),
        ]),
      );
    }
  } catch {
    // Fall through to raw fallback.
  }

  return { raw: sanitizeGemmaValue(normalizedArguments) };
};

const parseExecuteToolBlock = (rawContent: string, isOpen = false): GemmaContentBlock => {
  const visibleContent = sanitizeGemmaValue(normalizeVisibleText(rawContent));
  const functionMatch = visibleContent.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*)\}\s*$/);

  if (!functionMatch) {
    return {
      type: "execute_tool",
      content: visibleContent || rawContent.trim(),
      parsed: false,
      isOpen,
    };
  }

  const toolName = functionMatch[1];
  const toolArgs = extractGemmaArguments(functionMatch[2] ?? "");

  return {
    type: "execute_tool",
    content: visibleContent,
    toolName,
    toolArgs,
    parsed: true,
    isOpen,
  };
};

const pushTextBlock = (blocks: GemmaContentBlock[], value: string) => {
  const content = sanitizeGemmaValue(normalizeVisibleText(value));
  if (content.trim()) {
    blocks.push({ type: "text", content });
  }
};

export function parseGemmaContentBlocks(content: string): GemmaContentBlock[] {
  const blocks: GemmaContentBlock[] = [];
  const preprocessed = preprocessGemmaStream(content);
  let remaining = preprocessed.normalizedContent;

  while (remaining) {
    const nextTag = findNextTag(remaining);
    if (!nextTag) {
      pushTextBlock(blocks, remaining);
      break;
    }

    if (nextTag.index > 0) {
      pushTextBlock(blocks, remaining.slice(0, nextTag.index));
    }

    const tagName = nextTag.tagName;
    const openTag = tagName === "think" ? "<think>" : "<execute_tool>";
    const closeTag = tagName === "think" ? "</think>" : "</execute_tool>";
    const afterOpen = remaining.slice(nextTag.index + openTag.length);
    const closeIndex = afterOpen.indexOf(closeTag);

    if (closeIndex === -1) {
      if (tagName === "execute_tool") {
        blocks.push(parseExecuteToolBlock(afterOpen, true));
      } else {
        blocks.push({
          type: "think",
          content: sanitizeGemmaValue(normalizeVisibleText(afterOpen)),
          parsed: true,
          isOpen: true,
        });
      }
      break;
    }

    const innerContent = afterOpen.slice(0, closeIndex);

    if (tagName === "execute_tool") {
      blocks.push(parseExecuteToolBlock(innerContent));
    } else {
      blocks.push({
        type: "think",
        content: sanitizeGemmaValue(normalizeVisibleText(innerContent)),
        parsed: true,
        isOpen: false,
      });
    }

    remaining = afterOpen.slice(closeIndex + closeTag.length);
  }

  if (preprocessed.hasOpenThink) {
    const thinkBlocks = blocks.filter((block) => block.type === "think");
    const lastThinkBlock = thinkBlocks[thinkBlocks.length - 1];
    if (lastThinkBlock) {
      lastThinkBlock.isOpen = true;
    }
  }

  if (preprocessed.hasOpenExecuteTool) {
    const executeBlocks = blocks.filter((block) => block.type === "execute_tool");
    const lastExecuteBlock = executeBlocks[executeBlocks.length - 1];
    if (lastExecuteBlock) {
      lastExecuteBlock.isOpen = true;
    }
  }

  return blocks;
}
