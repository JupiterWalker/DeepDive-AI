export interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface Column {
  id: string;
  title: string;
  parentId: string | null; // The ID of the column that spawned this one
  parentMessageId: string | null; // The ID of the specific message in the parent column
  contextSnippet: string | null; // The text selected to spawn this branch
  messages: Message[];
  inputValue: string;
  isThinking: boolean;
}

export interface BranchRequest {
  sourceColumnId: string;
  sourceMessageId: string;
  selectedText: string;
}