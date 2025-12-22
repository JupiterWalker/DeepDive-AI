import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Message, Column } from '../types';

interface MessageBubbleProps {
  message: Message;
  columnId: string;
  onBranch: (text: string, messageId: string, customPrompt?: string) => void;
  isLatestModel: boolean;
  childColumns?: Column[]; // Columns that branched off from this message
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ 
  message, 
  columnId, 
  onBranch,
  isLatestModel,
  childColumns = []
}) => {
  const [selection, setSelection] = useState<{ x: number, y: number, text: string } | null>(null);
  const [inputMode, setInputMode] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const textRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle text selection
  const handleMouseUp = () => {
    const windowSelection = window.getSelection();
    if (!windowSelection || windowSelection.rangeCount === 0) return;

    const text = windowSelection.toString().trim();
    if (text.length > 0 && textRef.current?.contains(windowSelection.anchorNode)) {
      const range = windowSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      
      setSelection({
        x: rect.left + (rect.width / 2),
        y: rect.top,
        text: text
      });
      setInputMode(false);
      setCustomQuery('');
    }
  };

  useEffect(() => {
    const clearSelection = (e: Event) => {
      // If clicking inside the tooltip input or buttons, don't clear
      const target = e.target as HTMLElement;
      if (target && target.closest && target.closest('.branch-tooltip')) return;
      setSelection(null);
    };
    
    // Clear selection on mousedown (click outside) and wheel (scroll/zoom)
    document.addEventListener('mousedown', clearSelection);
    window.addEventListener('wheel', clearSelection);
    
    return () => {
        document.removeEventListener('mousedown', clearSelection);
        window.removeEventListener('wheel', clearSelection);
    };
  }, []);

  useEffect(() => {
    if (inputMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [inputMode]);

  const handleDeepDive = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (selection) {
      onBranch(selection.text, message.id);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleCustomAskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selection && customQuery.trim()) {
      onBranch(selection.text, message.id, customQuery);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const isUser = message.role === 'user';

  // Custom renderer logic to highlight snippets recursively
  const components = useMemo(() => {
    if (childColumns.length === 0) return undefined;

    const processText = (text: string): React.ReactNode[] => {
      if (!text) return [text];
      
      // Find all matches
      const matches: {start: number, end: number, colId: string}[] = [];
      
      childColumns.forEach(col => {
          if (!col.contextSnippet) return;
          const snippet = col.contextSnippet.trim();
          if (!snippet) return;

          // Simple substring match
          let idx = text.indexOf(snippet);
          while (idx !== -1) {
             // Ensure we don't already have an overlapping match (greedy, first come first serve for MVP)
             const isOverlapping = matches.some(m => 
                 (idx >= m.start && idx < m.end) || (idx + snippet.length > m.start && idx + snippet.length <= m.end)
             );
             
             if (!isOverlapping) {
                 matches.push({
                     start: idx,
                     end: idx + snippet.length,
                     colId: col.id
                 });
             }
             idx = text.indexOf(snippet, idx + 1);
          }
      });
      
      if (matches.length === 0) return [text];
      
      matches.sort((a, b) => a.start - b.start);
      
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      
      matches.forEach(match => {
          if (match.start > cursor) {
              parts.push(text.slice(cursor, match.start));
          }
          
          parts.push(
              <span 
                  key={match.colId} 
                  id={`source-${match.colId}`}
                  className="source-highlight"
              >
                  {text.slice(match.start, match.end)}
              </span>
          );
          cursor = match.end;
      });
      
      if (cursor < text.length) {
          parts.push(text.slice(cursor));
      }
      
      return parts;
    };

    const recursiveRenderer = ({ node, children, ...props }: any) => {
       const Tag = node.tagName as any;
       
       // Process children recursively
       const processedChildren = React.Children.map(children, (child) => {
           if (typeof child === 'string') {
               return processText(child);
           }
           // If child is a React element (e.g. from nested markdown), it's opaque here in 'children' array usually?
           // Actually ReactMarkdown passes already-rendered children. 
           // We apply the renderer to all container types so it flows down.
           return child;
       });

       return <Tag {...props}>{processedChildren}</Tag>;
    };

    // Apply to common text containers, including headers and tables
    return {
        p: recursiveRenderer,
        li: recursiveRenderer,
        strong: recursiveRenderer,
        em: recursiveRenderer,
        span: recursiveRenderer,
        blockquote: recursiveRenderer,
        h1: recursiveRenderer,
        h2: recursiveRenderer,
        h3: recursiveRenderer,
        h4: recursiveRenderer,
        h5: recursiveRenderer,
        h6: recursiveRenderer,
        td: recursiveRenderer,
        th: recursiveRenderer,
        a: ({node, ...props}: any) => <a target="_blank" rel="noopener noreferrer" {...props} />
    };
  }, [childColumns]);

  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`relative px-3 py-2.5 rounded-xl text-sm leading-relaxed shadow-lg
          ${isUser 
            ? 'bg-indigo-600 text-white rounded-br-none max-w-[85%]' 
            : 'bg-gray-850 text-gray-100 rounded-bl-none border border-gray-700 shadow-xl max-w-[98%]'
          }`}
      >
        <div 
          ref={textRef}
          onMouseUp={!isUser ? handleMouseUp : undefined}
          className="prose prose-invert prose-sm max-w-none break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 cursor-text"
        >
          {isUser ? (
             <div className="whitespace-pre-wrap font-sans">{message.text}</div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={components}
            >
              {message.text}
            </ReactMarkdown>
          )}
        </div>
        
        {/* Tooltip - Using Portal to render at body level to avoid Transform clipping/positioning issues */}
        {selection && !isUser && createPortal(
          <div 
            className="branch-tooltip fixed z-[9999] transform -translate-x-1/2 -translate-y-full mb-2 flex flex-col items-center animate-in fade-in zoom-in duration-200"
            style={{ left: selection.x, top: selection.y - 12 }}
            onMouseDown={(e) => e.stopPropagation()} 
          >
            <div className="bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-1.5 flex items-center gap-1">
              {!inputMode ? (
                <>
                  <button
                    onClick={handleDeepDive}
                    className="hover:bg-indigo-600 text-gray-200 hover:text-white text-xs font-medium py-1.5 px-3 rounded-md transition-colors flex items-center gap-1.5"
                  >
                    <span className="text-indigo-400 group-hover:text-white">✨</span> Deep Dive
                  </button>
                  <div className="w-[1px] h-4 bg-gray-700 mx-0.5"></div>
                  <button
                    onClick={() => setInputMode(true)}
                    className="hover:bg-gray-700 text-gray-200 text-xs font-medium py-1.5 px-3 rounded-md transition-colors flex items-center gap-1.5"
                  >
                    <span>💬</span> Ask...
                  </button>
                </>
              ) : (
                <form onSubmit={handleCustomAskSubmit} className="flex items-center gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    placeholder="Ask about this..."
                    className="bg-gray-800 text-white text-xs border border-gray-600 rounded px-2 py-1 outline-none focus:border-indigo-500 w-48"
                  />
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white p-1 rounded transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode(false)}
                    className="text-gray-400 hover:text-white p-1"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </form>
              )}
            </div>
            {/* Arrow */}
            <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900 absolute left-1/2 -translate-x-1/2 bottom-[-6px]"></div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
};