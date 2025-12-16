import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  columnId: string;
  onBranch: (text: string, messageId: string) => void;
  isLatestModel: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ 
  message, 
  columnId, 
  onBranch,
  isLatestModel
}) => {
  const [selection, setSelection] = useState<{ x: number, y: number, text: string } | null>(null);
  const textRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = () => {
    const windowSelection = window.getSelection();
    if (!windowSelection || windowSelection.rangeCount === 0) return;

    const text = windowSelection.toString().trim();
    if (text.length > 0 && textRef.current?.contains(windowSelection.anchorNode)) {
      const range = windowSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      // Calculate position relative to viewport to position the tooltip
      setSelection({
        x: rect.left + (rect.width / 2),
        y: rect.top, // Position above the text
        text: text
      });
    } else {
      setSelection(null);
    }
  };

  // Clear selection if clicking elsewhere
  useEffect(() => {
    const clearSelection = () => setSelection(null);
    document.addEventListener('mousedown', clearSelection);
    return () => document.removeEventListener('mousedown', clearSelection);
  }, []);

  const handleBranchClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent clearing selection immediately
    if (selection) {
      onBranch(selection.text, message.id);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`relative max-w-[90%] p-3 rounded-lg text-sm leading-relaxed shadow-md
          ${isUser 
            ? 'bg-blue-600 text-white rounded-br-none' 
            : 'bg-gray-750 text-gray-100 rounded-bl-none border border-gray-600'
          }`}
      >
        <div 
          ref={textRef}
          onMouseUp={!isUser ? handleMouseUp : undefined}
          // 'prose' and 'prose-invert' give it the dark mode markdown styling.
          // 'prose-sm' keeps the font size compact.
          // 'break-words' and 'max-w-none' ensure it handles long content well.
          className="prose prose-invert prose-sm max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        >
          {isUser ? (
             // Simple render for user to avoid rendering their markdown if not desired, 
             // or keep consistent. Let's keep whitespace-pre-wrap for user messages 
             // to preserve their formatting exactly as typed, or use markdown if preferred.
             // Usually user input is just text, but let's treat it as text to match prev behavior.
             <div className="whitespace-pre-wrap font-sans">{message.text}</div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                // Custom overrides if needed, e.g. opening links in new tab
                a: ({node, ...props}) => <a target="_blank" rel="noopener noreferrer" {...props} />
              }}
            >
              {message.text}
            </ReactMarkdown>
          )}
        </div>
        
        <div className="text-[10px] opacity-50 mt-1 text-right">
          {new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>

        {/* Branching Tooltip */}
        {selection && !isUser && (
          <div 
            className="fixed z-50 transform -translate-x-1/2 -translate-y-full mb-2"
            style={{ left: selection.x, top: selection.y - 8 }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent document mousedown from firing
          >
            <button
              onClick={handleBranchClick}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-lg flex items-center gap-1 animate-in fade-in zoom-in duration-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v19"/><path d="M5 8h14"/><path d="M15 11l-3-3-3 3"/></svg>
              Deep Dive
            </button>
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-indigo-600 absolute left-1/2 -translate-x-1/2 bottom-[-6px]"></div>
          </div>
        )}
      </div>
    </div>
  );
};