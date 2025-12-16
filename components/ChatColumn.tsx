import React, { useRef, useEffect } from 'react';
import { Column, Message } from '../types';
import { MessageBubble } from './MessageBubble';

interface ChatColumnProps {
  column: Column;
  isActive: boolean;
  onSendMessage: (columnId: string, text: string) => void;
  onInputChange: (columnId: string, value: string) => void;
  onBranch: (columnId: string, messageId: string, text: string) => void;
  onClose?: (columnId: string) => void;
}

export const ChatColumn: React.FC<ChatColumnProps> = ({
  column,
  isActive,
  onSendMessage,
  onInputChange,
  onBranch,
  onClose
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [column.messages, column.isThinking]);

  // Focus input when column becomes active
  useEffect(() => {
    if (isActive && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isActive]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!column.inputValue.trim() || column.isThinking) return;
    onSendMessage(column.id, column.inputValue);
  };

  return (
    <div 
      className={`
        flex-shrink-0 w-[380px] h-full flex flex-col 
        border-r border-gray-700 bg-gray-900 
        transition-opacity duration-300
        ${isActive ? 'opacity-100' : 'opacity-60 hover:opacity-100'}
      `}
    >
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-gray-800 bg-gray-850">
        <div className="flex flex-col overflow-hidden">
            <h2 className="font-semibold text-gray-200 truncate" title={column.title}>
            {column.title || "Main Thread"}
            </h2>
            {column.contextSnippet && (
                <span className="text-[10px] text-indigo-400 truncate flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                    {column.contextSnippet}
                </span>
            )}
        </div>
        {onClose && (
          <button 
            onClick={() => onClose(column.id)}
            className="text-gray-500 hover:text-red-400 p-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {column.messages.length === 0 && (
          <div className="text-center text-gray-500 mt-10 text-sm">
            {column.parentId 
              ? "Start discussing this topic..." 
              : "Start a conversation..."}
          </div>
        )}
        
        {column.messages.map((msg) => (
          <MessageBubble 
            key={msg.id} 
            message={msg} 
            columnId={column.id}
            onBranch={(text, msgId) => onBranch(column.id, msgId, text)}
            isLatestModel={msg.role === 'model' && msg === column.messages[column.messages.length - 1]}
          />
        ))}

        {column.isThinking && (
          <div className="flex items-center gap-2 text-gray-400 text-xs ml-2 mb-4 animate-pulse">
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce delay-75"></div>
            <div className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce delay-150"></div>
            Thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-gray-850 border-t border-gray-800">
        <form onSubmit={handleSubmit} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={column.inputValue}
            onChange={(e) => onInputChange(column.id, e.target.value)}
            placeholder="Type a message..."
            className="w-full bg-gray-750 text-white border border-gray-600 rounded-full py-3 px-4 pr-12 text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder-gray-500"
            disabled={column.isThinking}
          />
          <button
            type="submit"
            disabled={!column.inputValue.trim() || column.isThinking}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};
