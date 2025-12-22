import { GoogleGenAI } from "@google/genai";
import { Column, Message } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Constructs the history chain for a specific column.
 * It traverses up the tree of columns to build a coherent conversation history.
 */
const buildHistoryForColumn = (targetColumnId: string, columns: Column[]) => {
  const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  
  // 1. Find the path from root to the target column
  const path: Column[] = [];
  let currentId: string | null = targetColumnId;

  while (currentId) {
    const col = columns.find(c => c.id === currentId);
    if (col) {
      path.unshift(col);
      currentId = col.parentId;
    } else {
      break;
    }
  }

  // 2. Flatten the messages from the path
  path.forEach((col, index) => {
    const isTarget = index === path.length - 1;
    
    // If it's not the target column (it's an ancestor), we only need messages 
    // up to the point where the branch happened.
    let relevantMessages = col.messages;
    
    if (!isTarget && index + 1 < path.length) {
      const nextCol = path[index + 1];
      const branchIndex = col.messages.findIndex(m => m.id === nextCol.parentMessageId);
      if (branchIndex !== -1) {
        // Include messages up to and including the branch point
        relevantMessages = col.messages.slice(0, branchIndex + 1);
      }
    }

    relevantMessages.forEach(msg => {
      history.push({
        role: msg.role,
        parts: [{ text: msg.text }]
      });
    });

    // If this column branched into the next one, add a simulated user prompt indicating the branch context
    if (!isTarget && index + 1 < path.length) {
      const nextCol = path[index + 1];
      if (nextCol.contextSnippet) {
        history.push({
          role: 'user',
          parts: [{ text: `I want to branch off and discuss specifically about: "${nextCol.contextSnippet}"` }]
        });
      }
    }
  });

  return history;
};

export const streamGeminiResponse = async (
  targetColumnId: string, 
  userMessage: string, 
  columns: Column[],
  onChunk: (text: string) => void
) => {
  const model = 'gemini-3-flash-preview';
  
  // Build history excluding the new user message we are about to send
  const history = buildHistoryForColumn(targetColumnId, columns);

  // If this is the very first message of a new branch (not the root), 
  // we might want to inject a system instruction or modify the prompt slightly
  // to acknowledge the context switch, but the history construction above handles the logical flow.

  const chat = ai.chats.create({
    model,
    history: history,
  });

  try {
    const resultStream = await chat.sendMessageStream({ message: userMessage });
    
    for await (const chunk of resultStream) {
      const text = chunk.text;
      if (text) {
        onChunk(text);
      }
    }
  } catch (error) {
    console.error("Gemini API Error:", error);
    onChunk("\n\n[Error: Unable to fetch response. Please check your connection or API key.]");
  }
};