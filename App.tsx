import React, { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Column, Message } from './types';
import { ChatColumn } from './components/ChatColumn';
import { streamGeminiResponse } from './services/geminiService';

const App: React.FC = () => {
  // Initialize with one default column
  const [columns, setColumns] = useState<Column[]>([
    {
      id: uuidv4(),
      title: 'Main Chat',
      parentId: null,
      parentMessageId: null,
      contextSnippet: null,
      messages: [],
      inputValue: '',
      isThinking: false
    }
  ]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to the rightmost column when a new one is added
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        left: scrollContainerRef.current.scrollWidth,
        behavior: 'smooth'
      });
    }
  }, [columns.length]);

  const handleInputChange = (columnId: string, value: string) => {
    setColumns(prev => prev.map(col => 
      col.id === columnId ? { ...col, inputValue: value } : col
    ));
  };

  const addMessageToColumn = (columnId: string, message: Message) => {
    setColumns(prev => prev.map(col => {
      if (col.id === columnId) {
        return {
          ...col,
          messages: [...col.messages, message],
          // Update title if it's the first user message and title is generic
          title: (col.messages.length === 0 && message.role === 'user' && !col.parentId) 
            ? (message.text.length > 20 ? message.text.substring(0, 20) + '...' : message.text)
            : col.title
        };
      }
      return col;
    }));
  };

  const updateLastMessage = (columnId: string, textChunk: string) => {
    setColumns(prev => prev.map(col => {
      if (col.id === columnId) {
        const msgs = [...col.messages];
        if (msgs.length > 0 && msgs[msgs.length - 1].role === 'model') {
          msgs[msgs.length - 1] = {
            ...msgs[msgs.length - 1],
            text: msgs[msgs.length - 1].text + textChunk
          };
        }
        return { ...col, messages: msgs };
      }
      return col;
    }));
  };

  const setThinking = (columnId: string, isThinking: boolean) => {
    setColumns(prev => prev.map(col => 
      col.id === columnId ? { ...col, isThinking } : col
    ));
  };

  const handleSendMessage = async (columnId: string, text: string) => {
    // 1. Add User Message
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      text: text,
      timestamp: Date.now()
    };
    addMessageToColumn(columnId, userMsg);
    handleInputChange(columnId, '');
    setThinking(columnId, true);

    // 2. Prepare Model Message placeholder
    const modelMsgId = uuidv4();
    const modelMsg: Message = {
      id: modelMsgId,
      role: 'model',
      text: '', // Starts empty
      timestamp: Date.now()
    };
    
    // Slight delay to allow render update
    setTimeout(() => {
        addMessageToColumn(columnId, modelMsg);
        
        // 3. Call Gemini
        streamGeminiResponse(
          columnId,
          text,
          columns,
          (chunk) => updateLastMessage(columnId, chunk)
        ).finally(() => {
          setThinking(columnId, false);
        });
    }, 100);
  };

  const handleBranch = (sourceColumnId: string, sourceMessageId: string, selectedText: string) => {
    const sourceColumnIndex = columns.findIndex(c => c.id === sourceColumnId);
    if (sourceColumnIndex === -1) return;

    // 1. Truncate any columns that exist AFTER the source column.
    // This implements the "Miller Columns" logic where branching from an earlier point
    // replaces the subsequent path.
    const newColumns = columns.slice(0, sourceColumnIndex + 1);

    // 2. Create the new Branch Column
    const newColId = uuidv4();
    const newColumn: Column = {
      id: newColId,
      title: selectedText.length > 15 ? selectedText.substring(0, 15) + '...' : selectedText,
      parentId: sourceColumnId,
      parentMessageId: sourceMessageId,
      contextSnippet: selectedText,
      messages: [],
      inputValue: '',
      isThinking: false
    };

    setColumns([...newColumns, newColumn]);

    // 3. Automatically trigger a "deep dive" explanation in the new column
    const initialPrompt = `Tell me more about "${selectedText}" in the context of our previous conversation.`;
    handleSendMessage(newColId, initialPrompt);
  };

  const handleCloseColumn = (columnId: string) => {
    // Cannot close the root column (index 0)
    const index = columns.findIndex(c => c.id === columnId);
    if (index <= 0) return;

    setColumns(prev => prev.slice(0, index));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-950 text-gray-100 font-sans">
      {/* Top Bar */}
      <header className="h-12 border-b border-gray-800 flex items-center px-6 bg-gray-900 shadow-sm z-10 flex-shrink-0">
        <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v19"/><path d="M5 8h14"/><path d="M15 11l-3-3-3 3"/></svg>
            </div>
            <h1 className="font-bold text-lg tracking-tight">DeepDive AI</h1>
        </div>
        <div className="ml-auto text-xs text-gray-500 flex items-center gap-4">
            <span className="hidden sm:inline">Highlight any text in a response to branch the conversation.</span>
            <a href="https://github.com/google-gemini/gemini-api-cookbook" target="_blank" rel="noreferrer" className="hover:text-indigo-400 transition-colors">Powered by Gemini</a>
        </div>
      </header>

      {/* Main Canvas - Horizontally Scrollable */}
      <main 
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden flex items-stretch"
        style={{ scrollBehavior: 'smooth' }}
      >
        <div className="flex h-full">
            {columns.map((col, index) => (
            <ChatColumn
                key={col.id}
                column={col}
                isActive={index === columns.length - 1}
                onSendMessage={handleSendMessage}
                onInputChange={handleInputChange}
                onBranch={handleBranch}
                onClose={index > 0 ? handleCloseColumn : undefined}
            />
            ))}
            
            {/* Visual Spacer at the end */}
            <div className="w-20 flex-shrink-0"></div>
        </div>
      </main>
    </div>
  );
};

export default App;
