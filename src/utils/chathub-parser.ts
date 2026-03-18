/**
 * Chat-Hub message parser — forked from n8n's @n8n/chat-hub/src/parser.ts
 *
 * Handles incremental chunk parsing for streaming content. Supports:
 * - Plain text chunks
 * - artifact-create commands (<command:artifact-create>...</command:artifact-create>)
 * - artifact-edit commands (<command:artifact-edit>...</command:artifact-edit>)
 * - Hidden content (partial command prefixes buffered across chunk boundaries)
 * - with-buttons JSON content
 *
 * Also includes the artifact collector for accumulating create/edit commands
 * into document artifacts.
 */

import type {
  ChatArtifact,
  ChatHubMessageButton,
  ChatHubMessageType,
  ChatMessageContentChunk,
} from '@/types/chathub';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MessageWithContent {
  type: ChatHubMessageType;
  content: string;
}

interface ButtonsPayload {
  text: string;
  buttons: ChatHubMessageButton[];
  blockUserInput: boolean;
}

// ---------------------------------------------------------------------------
// Incremental chunk parser
// ---------------------------------------------------------------------------

/**
 * Append a raw text chunk to an existing array of parsed content chunks.
 * Handles incomplete command buffering across chunk boundaries.
 */
export function appendChunkToParsedMessageItems(
  items: ChatMessageContentChunk[],
  chunk: string,
): ChatMessageContentChunk[] {
  const result = [...items];
  let remaining = chunk;

  // If the last item is incomplete, append to it and re-parse
  if (result.length > 0) {
    const lastItem = result[result.length - 1];
    if (lastItem.type === 'hidden') {
      // Hidden item might be a command prefix, combine with new chunk and re-parse
      remaining = lastItem.content + chunk;
      result.pop();
    } else if (
      (lastItem.type === 'artifact-create' || lastItem.type === 'artifact-edit') &&
      lastItem.isIncomplete
    ) {
      // Incomplete command — append chunk and re-parse
      remaining = lastItem.content + chunk;
      result.pop();
    }
  }

  // Check if the chunk is button JSON (arrives as complete JSON in one chunk)
  const buttonChunk = tryParseButtonsJson(remaining);
  if (buttonChunk) {
    result.push(buttonChunk);
    return result;
  }

  // Parse the remaining content
  let currentPos = 0;
  const createCommandRegex = /<command:artifact-create>/g;
  const editCommandRegex = /<command:artifact-edit>/g;

  while (currentPos < remaining.length) {
    createCommandRegex.lastIndex = currentPos;
    editCommandRegex.lastIndex = currentPos;

    const createMatch = createCommandRegex.exec(remaining);
    const editMatch = editCommandRegex.exec(remaining);

    let nextMatch: RegExpExecArray | null = null;
    let commandType: 'create' | 'edit' | null = null;

    if (createMatch && editMatch) {
      if (createMatch.index < editMatch.index) {
        nextMatch = createMatch;
        commandType = 'create';
      } else {
        nextMatch = editMatch;
        commandType = 'edit';
      }
    } else if (createMatch) {
      nextMatch = createMatch;
      commandType = 'create';
    } else if (editMatch) {
      nextMatch = editMatch;
      commandType = 'edit';
    }

    if (!nextMatch || !commandType) {
      // No more commands, rest is text
      const textContent = remaining.slice(currentPos);
      if (textContent) {
        const { text, hiddenPrefix } = splitPotentialCommandPrefix(textContent);
        if (text) {
          addTextToResult(result, text);
        }
        if (hiddenPrefix) {
          result.push({ type: 'hidden', content: hiddenPrefix });
        }
      }
      break;
    }

    // Add text before the command
    if (nextMatch.index > currentPos) {
      const textContent = remaining.slice(currentPos, nextMatch.index);
      addTextToResult(result, textContent);
    }

    // Parse the command
    const commandStart = nextMatch.index;
    const commandContent = remaining.slice(commandStart);

    if (commandType === 'create') {
      const parsed = parseArtifactCreateCommand(commandContent);
      result.push(parsed.item);
      currentPos = commandStart + parsed.consumed;
    } else {
      const parsed = parseArtifactEditCommand(commandContent);
      result.push(parsed.item);
      currentPos = commandStart + parsed.consumed;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Full message parser
// ---------------------------------------------------------------------------

/**
 * Parse a complete message into content chunks.
 * Only AI messages get command parsing — other types are returned as plain text.
 */
export function parseMessage(message: MessageWithContent): ChatMessageContentChunk[] {
  if (message.type !== 'ai') {
    return [{ type: 'text' as const, content: message.content }];
  }

  return appendChunkToParsedMessageItems([], message.content);
}

// ---------------------------------------------------------------------------
// Artifact collector
// ---------------------------------------------------------------------------

/**
 * Collect artifacts from parsed content chunks.
 * Applies create commands to build documents, then edit commands to modify them.
 */
export function collectChatArtifacts(items: ChatMessageContentChunk[]): ChatArtifact[] {
  const artifacts: ChatArtifact[] = [];

  for (const item of items) {
    if (item.type === 'artifact-create') {
      if (!item.command.title) {
        continue;
      }

      artifacts.push({
        title: item.command.title,
        type: item.command.type,
        content: item.command.content,
      });
    } else if (item.type === 'artifact-edit') {
      const targetDoc = artifacts.find((doc) => doc.title === item.command.title);

      if (targetDoc) {
        if (item.command.replaceAll) {
          targetDoc.content = targetDoc.content
            .split(item.command.oldString)
            .join(item.command.newString);
        } else {
          targetDoc.content = targetDoc.content.replace(
            item.command.oldString,
            item.command.newString,
          );
        }
      }
    }
  }

  return artifacts;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function addTextToResult(result: ChatMessageContentChunk[], textContent: string): void {
  if (textContent === '') {
    return;
  }

  if (result.length > 0) {
    const lastItem = result[result.length - 1];
    if (lastItem.type === 'text') {
      result[result.length - 1] = { type: 'text', content: lastItem.content + textContent };
      return;
    }
  }
  result.push({ type: 'text', content: textContent });
}

function splitPotentialCommandPrefix(text: string): {
  text: string;
  hiddenPrefix: string;
} {
  const commandTags = ['<command:artifact-create>', '<command:artifact-edit>'];

  for (let len = 1; len <= Math.min(text.length, 30); len++) {
    const suffix = text.slice(-len);

    for (const tag of commandTags) {
      if (tag.startsWith(suffix)) {
        return {
          text: text.slice(0, -len),
          hiddenPrefix: suffix,
        };
      }
    }
  }

  return { text, hiddenPrefix: '' };
}

function parseArtifactCreateCommand(content: string): {
  item: ChatMessageContentChunk;
  consumed: number;
} {
  const closingTag = '</command:artifact-create>';
  const closingIndex = content.indexOf(closingTag);

  const isIncomplete = closingIndex === -1;
  const commandContent = isIncomplete
    ? content
    : content.slice(0, closingIndex + closingTag.length);

  const title = extractTagContent(commandContent, 'title') ?? '';
  const type = extractTagContent(commandContent, 'type') ?? '';
  const contentField = extractTagContent(commandContent, 'content') ?? '';

  return {
    item: {
      type: 'artifact-create',
      content: commandContent,
      command: { title, type, content: contentField },
      isIncomplete,
    },
    consumed: commandContent.length,
  };
}

function parseArtifactEditCommand(content: string): {
  item: ChatMessageContentChunk;
  consumed: number;
} {
  const closingTag = '</command:artifact-edit>';
  const closingIndex = content.indexOf(closingTag);

  const isIncomplete = closingIndex === -1;
  const commandContent = isIncomplete
    ? content
    : content.slice(0, closingIndex + closingTag.length);

  const title = extractTagContent(commandContent, 'title') ?? '';
  const oldString = extractTagContent(commandContent, 'oldString') ?? '';
  const newString = extractTagContent(commandContent, 'newString') ?? '';
  const replaceAllStr = extractTagContent(commandContent, 'replaceAll') ?? 'false';
  const replaceAll = replaceAllStr.toLowerCase() === 'true';

  return {
    item: {
      type: 'artifact-edit',
      content: commandContent,
      command: { title, oldString, newString, replaceAll },
      isIncomplete,
    },
    consumed: commandContent.length,
  };
}

function extractTagContent(xml: string, tagName: string): string | null {
  const openTag = `<${tagName}>`;
  const closeTag = `</${tagName}>`;

  const startIndex = xml.indexOf(openTag);
  if (startIndex === -1) {
    return null;
  }

  const contentStart = startIndex + openTag.length;
  const endIndex = xml.indexOf(closeTag, contentStart);

  if (endIndex === -1) {
    let content = xml.slice(contentStart);

    // Check if content ends with a partial closing tag and exclude it
    for (let len = 1; len < closeTag.length; len++) {
      const partialCloseTag = closeTag.slice(0, len);
      if (content.endsWith(partialCloseTag)) {
        content = content.slice(0, -len);
        break;
      }
    }

    return content.length > 0 ? content : null;
  }

  return xml.slice(contentStart, endIndex);
}

/**
 * Try to parse content as a buttons JSON payload.
 * Replaces n8n's Zod-based validation with a simple structural check.
 */
function tryParseButtonsJson(content: string): ChatMessageContentChunk | null {
  if (!content.startsWith('{')) return null;

  try {
    const parsed: unknown = JSON.parse(content);

    if (!isButtonsPayload(parsed)) return null;

    return {
      type: 'with-buttons',
      content: parsed.text,
      buttons: parsed.buttons,
      blockUserInput: parsed.blockUserInput,
    };
  } catch {
    // Not valid JSON
  }
  return null;
}

function isButtonsPayload(value: unknown): value is ButtonsPayload {
  if (typeof value !== 'object' || value === null) return false;

  const obj = value as Record<string, unknown>;

  if (typeof obj.text !== 'string') return false;
  if (typeof obj.blockUserInput !== 'boolean') return false;
  if (!Array.isArray(obj.buttons)) return false;

  return obj.buttons.every(
    (btn: unknown) =>
      typeof btn === 'object' &&
      btn !== null &&
      typeof (btn as Record<string, unknown>).text === 'string' &&
      typeof (btn as Record<string, unknown>).link === 'string' &&
      ((btn as Record<string, unknown>).type === 'primary' ||
        (btn as Record<string, unknown>).type === 'secondary'),
  );
}
