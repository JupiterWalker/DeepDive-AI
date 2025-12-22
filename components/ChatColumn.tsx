import React, { useRef, useEffect } from 'react';
import { Column } from '../types';
import { MessageBubble } from './MessageBubble';

interface ChatColumnProps {
  column: Column;
  childColumns: Column[]; // Pass all columns to find children of this column
  isActive: boolean;
  onBranch: (columnId: string, messageId: string, text: string, customPrompt?: string) => void;
  onClose?: (columnId: string) => void;
  onSelect: (columnId: string) => void;
  onScroll?: () => void;
  onHeightChange?: (id: string, height: number) => void;
  onToggleCollapse: (columnId: string) => void;
  onHeaderMouseDown: (e: React.MouseEvent, columnId: string) => void;
}

export const ChatColumn: React.FC<ChatColumnProps> = ({
  column,
  childColumns,
  isActive,
  onBranch,
  onClose,
  onSelect,
  onScroll,
  onHeightChange,
  onToggleCollapse,
  onHeaderMouseDown
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Find which columns branch off immediately from this one
  const directChildren = childColumns.filter(c => c.parentId === column.id);

  useEffect(() => {
    if (!containerRef.current || !onHeightChange) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onHeightChange(column.id, entry.contentRect.height);
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [column.id, onHeightChange, column.isCollapsed]);

  return (
    <div 
        ref={containerRef}
        id={`column-${column.id}`}
        onClick={() => onSelect(column.id)}
        className={`
            flex flex-col w-[450px]
            ${column.isCollapsed ? 'h-auto' : 'min-h-[200px]'} 
            rounded-2xl border bg-gray-900 shadow-2xl
            transition-all duration-300 relative group
            ${isActive 
              ? 'border-indigo-500 ring-2 ring-indigo-500/50 shadow-indigo-500/20 z-10' 
              : 'border-gray-700 hover:border-gray-600 opacity-90 hover:opacity-100'
            }
        `}
    >
      {/* Header - Draggable Area */}
      <div 
        className={`
            h-12 px-4 flex items-center justify-between border-b backdrop-blur-sm cursor-move
            ${column.isCollapsed ? 'rounded-2xl border-transparent' : 'rounded-t-2xl'}
            ${isActive ? 'bg-indigo-900/20 border-indigo-500/30' : 'bg-gray-850/50 border-gray-800'}
        `}
        onMouseDown={(e) => onHeaderMouseDown(e, column.id)}
        onDoubleClick={() => onToggleCollapse(column.id)}
      >
        <div className="flex items-center gap-3 overflow-hidden flex-1 pointer-events-none">
             <button 
                onClick={(e) => { e.stopPropagation(); onToggleCollapse(column.id); }}
                className="text-gray-400 hover:text-white transition-colors pointer-events-auto"
             >
                {column.isCollapsed ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                )}
             </button>

            <div className="flex flex-col overflow-hidden">
                <h2 className={`font-semibold truncate text-sm ${isActive ? 'text-white' : 'text-gray-300'}`} title={column.title}>
                {column.title || "New Thread"}
                </h2>
                {column.contextSnippet && !column.isCollapsed && (
                    <span className="text-[10px] text-indigo-400 truncate flex items-center gap-1 opacity-90">
                    <span className="w-1 h-1 rounded-full bg-indigo-500 inline-block"></span>
                        From: "{column.contextSnippet}"
                    </span>
                )}
            </div>
        </div>
        
        {onClose && (
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(column.id); }}
            className="text-gray-500 hover:text-red-400 p-1.5 hover:bg-white/5 rounded-full transition-colors ml-2 pointer-events-auto"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>

      {/* Messages Area - Hidden if collapsed */}
      {!column.isCollapsed && (
          <div className="flex-1 p-4 bg-gray-900/95 relative animate-in slide-in-from-top-2 duration-200 pb-8">
            {column.messages.length === 0 && (
            <div className="text-center text-gray-600 mt-10 text-xs">
                <div className="w-8 h-8 bg-gray-800 rounded-full mx-auto mb-2 flex items-center justify-center text-xl grayscale opacity-50">✨</div>
                {column.parentId 
                ? "Thread started..." 
                : "Start a conversation..."}
            </div>
            )}
            
            {column.messages.map((msg) => (
            <MessageBubble 
                key={msg.id} 
                message={msg} 
                columnId={column.id}
                onBranch={(text, msgId, customPrompt) => onBranch(column.id, msgId, text, customPrompt)}
                isLatestModel={msg.role === 'model' && msg === column.messages[column.messages.length - 1]}
                childColumns={directChildren.filter(c => c.parentMessageId === msg.id)}
            />
            ))}

            {column.isThinking && (
            <div className="flex items-center gap-2 text-gray-400 text-xs ml-2 mb-4">
                <div className="flex space-x-1">
                    <div className="w-1 bg-indigo-500 rounded-full animate-bounce h-1"></div>
                    <div className="w-1 bg-indigo-500 rounded-full animate-bounce delay-75 h-1"></div>
                    <div className="w-1 bg-indigo-500 rounded-full animate-bounce delay-150 h-1"></div>
                </div>
                Thinking...
            </div>
            )}
            <div ref={messagesEndRef} />
            
            {/* Bottom Collapse Button */}
            <div className={`absolute bottom-0 left-0 h-4 w-full rounded-b-2xl flex items-center justify-center transition-all duration-300 ${isActive ? 'bg-indigo-900/10' : 'bg-transparent'}`}>
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(column.id); }}
                    className="absolute -bottom-3 bg-gray-800 hover:bg-indigo-600 border border-gray-700 hover:border-indigo-500 text-gray-400 hover:text-white rounded-full p-1 shadow-lg transition-all opacity-0 group-hover:opacity-100"
                    title="Collapse"
                >
                     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                </button>
            </div>
          </div>
      )}
    </div>
  );
};