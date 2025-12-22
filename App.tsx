import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Column, Message } from './types';
import { ChatColumn } from './components/ChatColumn';
import { streamGeminiResponse } from './services/geminiService';

// Layout Constants
const NODE_WIDTH = 450;
const NODE_GAP_X = 150;
const NODE_GAP_Y = 50;
const NODE_DEFAULT_HEIGHT = 200; // Fallback height

interface ConnectorLine {
  id: string;
  path: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

// Minimap Component
const Minimap: React.FC<{
  layout: Map<string, {x: number, y: number, height: number}>;
  nodeOffsets: Map<string, {x: number, y: number}>;
  pan: {x: number, y: number};
  scale: number;
  viewportSize: {w: number, h: number};
}> = ({ layout, nodeOffsets, pan, scale, viewportSize }) => {
  if (layout.size === 0) return null;

  // Calculate World Bounds
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  
  layout.forEach((pos, id) => {
    const offset = nodeOffsets.get(id) || {x: 0, y: 0};
    const x = pos.x + offset.x;
    const y = pos.y + offset.y - (pos.height / 2);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + NODE_WIDTH);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y + pos.height);
  });

  // Add padding to bounds
  const padding = 500;
  minX -= padding;
  maxX += padding;
  minY -= padding;
  maxY += padding;
  
  const worldW = maxX - minX;
  const worldH = maxY - minY;

  // Minimap dimensions
  const mapW = 200;
  const mapH = 150;
  
  // Calculate scaling ratio to fit world into minimap
  const ratioX = mapW / worldW;
  const ratioY = mapH / worldH;
  const ratio = Math.min(ratioX, ratioY);

  const renderW = worldW * ratio;
  const renderH = worldH * ratio;
  
  const offsetX = (mapW - renderW) / 2;
  const offsetY = (mapH - renderH) / 2;

  // Viewport Rect calculation
  // Viewport in world coords:
  const vpWorldX = -pan.x / scale;
  const vpWorldY = -pan.y / scale;
  const vpWorldW = viewportSize.w / scale;
  const vpWorldH = viewportSize.h / scale;

  return (
    <div className="absolute top-20 right-6 w-[200px] h-[150px] bg-gray-900/80 border border-gray-700 rounded-lg shadow-2xl backdrop-blur-sm z-50 overflow-hidden pointer-events-none">
       <div className="relative w-full h-full">
          {/* Nodes */}
          {Array.from(layout.entries()).map(([id, pos]) => {
              const offset = nodeOffsets.get(id) || {x: 0, y: 0};
              const x = pos.x + offset.x;
              const y = pos.y + offset.y - (pos.height / 2);
              
              return (
                  <div 
                    key={id}
                    className="absolute bg-indigo-500/50 rounded-sm"
                    style={{
                        left: offsetX + (x - minX) * ratio,
                        top: offsetY + (y - minY) * ratio,
                        width: NODE_WIDTH * ratio,
                        height: pos.height * ratio
                    }}
                  />
              );
          })}
          
          {/* Viewport Rect */}
          <div 
            className="absolute border-2 border-white/50 rounded-sm shadow-[0_0_0_1000px_rgba(0,0,0,0.5)]"
            style={{
                left: offsetX + (vpWorldX - minX) * ratio,
                top: offsetY + (vpWorldY - minY) * ratio,
                width: vpWorldW * ratio,
                height: vpWorldH * ratio
            }}
          />
       </div>
    </div>
  );
};


const App: React.FC = () => {
  const [hasStarted, setHasStarted] = useState(false);
  const [landingInput, setLandingInput] = useState('');
  
  // State
  const [columns, setColumns] = useState<Column[]>([
    {
      id: uuidv4(),
      title: 'Root',
      parentId: null,
      parentMessageId: null,
      contextSnippet: null,
      messages: [],
      inputValue: '',
      isThinking: false,
      isCollapsed: false
    }
  ]);
  const [selectedColumnId, setSelectedColumnId] = useState<string>(columns[0].id);
  const [globalInput, setGlobalInput] = useState('');
  
  // Dynamic Height State
  const [nodeHeights, setNodeHeights] = useState<Map<string, number>>(new Map());

  const handleNodeResize = useCallback((id: string, height: number) => {
    setNodeHeights(prev => {
        // Prevent updates for small fluctuations to avoid infinite loops
        if (Math.abs((prev.get(id) || 0) - height) < 2) return prev;
        const newMap = new Map(prev);
        newMap.set(id, height);
        return newMap;
    });
  }, []);

  // Infinite Canvas State
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1); // Zoom scale
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  
  // Dragging State
  const dragRef = useRef<{
    type: 'canvas' | 'node';
    startX: number;
    startY: number;
    targetId?: string;
    initialPan?: {x: number, y: number};
    initialNodeOffset?: {x: number, y: number};
  } | null>(null);

  const lastMousePos = useRef({ x: 0, y: 0 });
  
  const [layout, setLayout] = useState<Map<string, {x: number, y: number, height: number}>>(new Map());
  const [nodeOffsets, setNodeOffsets] = useState<Map<string, {x: number, y: number}>>(new Map());
  const [lines, setLines] = useState<ConnectorLine[]>([]);
  const [viewportSize, setViewportSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Update viewport size on resize
  useEffect(() => {
    const handleResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Tree Layout Algorithm (Stable / Waterfall) ---
  const calculateLayout = useMemo(() => {
    const newLayout = new Map<string, {x: number, y: number, height: number}>();
    
    // Helper to get children
    const getChildren = (parentId: string | null) => columns.filter(c => c.parentId === parentId);

    // Recursive function to position nodes top-down.
    // Returns the Y coordinate of the BOTTOM of the subtree rooted at nodeId.
    const positionNode = (nodeId: string, x: number, startY: number): number => {
      const currentHeight = nodeHeights.get(nodeId) || NODE_DEFAULT_HEIGHT;
      
      // Place the current node. 
      // We align the node's visual top with 'startY'.
      // 'y' in our layout map represents the CENTER of the node (for CSS transform consistency)
      const nodeCenterY = startY + (currentHeight / 2);
      newLayout.set(nodeId, {x, y: nodeCenterY, height: currentHeight});
      
      const children = getChildren(nodeId);
      
      // If leaf node, return the bottom of this node
      if (children.length === 0) {
        return startY + currentHeight;
      }

      // If has children, place them.
      let currentChildTopY = startY; 
      
      children.forEach(child => {
        const childSubtreeBottom = positionNode(
          child.id, 
          x + NODE_WIDTH + NODE_GAP_X, 
          currentChildTopY
        );
        // The next sibling starts after the previous sibling's entire subtree + gap
        currentChildTopY = childSubtreeBottom + NODE_GAP_Y;
      });

      // The bottom of this specific node's subtree is defined by the last child's bottom position.
      // (currentChildTopY has already added one extra GAP, so remove it)
      const lastChildBottom = currentChildTopY - NODE_GAP_Y;

      // Ensure the subtree height accounts for the node itself growing larger than its children stack
      const myBottom = startY + currentHeight;
      return Math.max(myBottom, lastChildBottom);
    };

    // Start layout from Root(s)
    let currentRootTopY = 0;
    const roots = getChildren(null);
    
    roots.forEach(root => {
        const rootBottom = positionNode(root.id, 0, currentRootTopY);
        currentRootTopY = rootBottom + NODE_GAP_Y;
    });

    return newLayout;
  }, [columns, nodeHeights]);

  useEffect(() => {
      setLayout(calculateLayout);
  }, [calculateLayout]);


  // --- Connector Lines Logic ---
  const calculateLines = useCallback(() => {
    if (layout.size === 0) return;
    
    const newLines: ConnectorLine[] = [];

    columns.forEach(col => {
      if (!col.parentId) return;
      
      const pos = layout.get(col.id); // Child position (Base)
      const parentPos = layout.get(col.parentId); // Parent position (Base)
      
      if (pos && parentPos) {
          // Add offsets
          const childOffset = nodeOffsets.get(col.id) || {x: 0, y: 0};
          const parentOffset = nodeOffsets.get(col.parentId) || {x: 0, y: 0};

          const finalChildX = pos.x + childOffset.x;
          const finalChildY = pos.y + childOffset.y;
          
          const finalParentX = parentPos.x + parentOffset.x;
          const finalParentY = parentPos.y + parentOffset.y;


          const sourceId = `source-${col.id}`;
          const sourceEl = document.getElementById(sourceId);

          let startX = finalParentX + NODE_WIDTH; // Default to right edge of card
          let startY = finalParentY; // Default to center of card

          // Use DOM positions for accuracy
          if (contentRef.current) {
              const contentRect = contentRef.current.getBoundingClientRect();
              
              if (sourceEl) {
                  // Connect from the specific highlighted text
                  const rects = sourceEl.getClientRects();
                  let visualTop = 0;
                  let visualRight = 0;

                  if (rects.length > 0) {
                      const lastRect = rects[rects.length - 1];
                      visualTop = lastRect.top + (lastRect.height / 2);
                      visualRight = lastRect.right;
                  } else {
                       const sourceRect = sourceEl.getBoundingClientRect();
                       visualTop = sourceRect.top + (sourceRect.height / 2);
                       visualRight = sourceRect.right;
                  }

                  // Adjust for Scale:
                  startY = (visualTop - contentRect.top) / scale;
                  startX = (visualRight - contentRect.left) / scale + 5;

              } else {
                   // Fallback: Default to Top Right (Header area) if source not found
                   // We need to calculate manual fallback based on updated parent position
                   startY = (finalParentY - (parentPos.height / 2)) + 24; 
                   startX = finalParentX + NODE_WIDTH;
              }
          }

          const endX = finalChildX;
          const endY = finalChildY; // Center of target node (vertical)

          // Bezier Calculation
          const dist = Math.abs(endX - startX);
          const cp1X = startX + (dist * 0.5);
          const cp2X = endX - (dist * 0.5); // Symmetrical curve

          const path = `M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}`;
          newLines.push({ 
            id: col.id, 
            path,
            startX,
            startY,
            endX,
            endY
          });
      }
    });
    setLines(newLines);
  }, [layout, columns, scale, nodeOffsets]); 

  // Handle scroll events from columns (removed) -> no longer needed as there is no internal scroll
  // But we might need to recalculate lines if height changes animate
  useEffect(() => {
     if (!hasStarted) return;
     // Calculate lines immediately and after a short delay to allow DOM to settle
     calculateLines();
     // Multiple passes to catch animation frames
     const timers = [
         setTimeout(calculateLines, 100),
         setTimeout(calculateLines, 300),
         setTimeout(calculateLines, 500)
     ];
     window.addEventListener('resize', calculateLines);
     return () => {
         timers.forEach(t => clearTimeout(t));
         window.removeEventListener('resize', calculateLines);
     };
  }, [layout, hasStarted, calculateLines, nodeHeights, scale, nodeOffsets]); 


  // --- Panning, Zooming & Dragging Interaction ---
  const handleMouseDown = (e: React.MouseEvent) => {
      // Background Drag (Pan)
      if (e.button === 0 || e.button === 1) {
         if ((e.target as HTMLElement).closest('.chat-column-container')) return;

         dragRef.current = {
             type: 'canvas',
             startX: e.clientX,
             startY: e.clientY,
             initialPan: { ...pan }
         };
         if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
      }
  };

  const handleNodeDragStart = (e: React.MouseEvent, columnId: string) => {
      e.stopPropagation();
      e.preventDefault();
      
      const currentOffset = nodeOffsets.get(columnId) || { x: 0, y: 0 };
      
      dragRef.current = {
          type: 'node',
          startX: e.clientX,
          startY: e.clientY,
          targetId: columnId,
          initialNodeOffset: currentOffset
      };
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
  };

  const handleWheel = useCallback((e: React.WheelEvent) => {
      if (!hasStarted) return;
      e.stopPropagation(); 
      // Zoom
      const zoomSensitivity = 0.001;
      const newScale = Math.min(Math.max(0.1, scale - e.deltaY * zoomSensitivity), 3);
      
      // Calculate new pan to zoom towards mouse pointer
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      
      const worldX = (mouseX - pan.x) / scale;
      const worldY = (mouseY - pan.y) / scale;
      
      const newPanX = mouseX - worldX * newScale;
      const newPanY = mouseY - worldY * newScale;

      setScale(newScale);
      setPan({ x: newPanX, y: newPanY });
  }, [scale, pan, hasStarted]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (!dragRef.current) return;
        e.preventDefault();
        
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;

        if (dragRef.current.type === 'canvas' && dragRef.current.initialPan) {
             setPan({
                 x: dragRef.current.initialPan.x + dx,
                 y: dragRef.current.initialPan.y + dy
             });
        } else if (dragRef.current.type === 'node' && dragRef.current.targetId && dragRef.current.initialNodeOffset) {
             // Calculate delta in WORLD coordinates (account for scale)
             const worldDx = dx / scale;
             const worldDy = dy / scale;
             
             const newOffset = {
                 x: dragRef.current.initialNodeOffset.x + worldDx,
                 y: dragRef.current.initialNodeOffset.y + worldDy
             };
             
             setNodeOffsets(prev => new Map(prev).set(dragRef.current!.targetId!, newOffset));
        }
    };
    
    const handleMouseUp = () => {
        dragRef.current = null;
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [scale]);

  // --- Auto-Focus Logic ---
  const focusNode = (nodeId: string) => {
      const pos = layout.get(nodeId);
      if (pos && viewportRef.current) {
          const offset = nodeOffsets.get(nodeId) || {x: 0, y: 0};
          const finalX = pos.x + offset.x;
          const finalY = pos.y + offset.y;

          const viewportW = viewportRef.current.clientWidth;
          const viewportH = viewportRef.current.clientHeight;
          
          // Center the node
          const targetX = (viewportW / 2) - (finalX * scale) - ((NODE_WIDTH / 2) * scale);
          const targetY = (viewportH / 2) - (finalY * scale); 
          
          setPan({ x: targetX, y: targetY });
      }
  };

  useEffect(() => {
      if (hasStarted && columns.length > 0) {
          // Only auto-focus on initial load or creation, 
          // might want to be careful not to jump around if user is dragging
          if (!dragRef.current) {
              focusNode(selectedColumnId);
          }
      }
  }, [selectedColumnId, hasStarted, layout]); 


  // --- Event Handlers (Business Logic) ---
  
  const handleToggleCollapse = (columnId: string) => {
    setColumns(prev => prev.map(col => 
      col.id === columnId ? { ...col, isCollapsed: !col.isCollapsed } : col
    ));
  };

  const addMessageToColumn = (columnId: string, message: Message) => {
    setColumns(prev => prev.map(col => {
      if (col.id === columnId) {
        return {
          ...col,
          messages: [...col.messages, message],
          title: (col.messages.length === 0 && message.role === 'user' && !col.parentId) 
            ? (message.text.length > 30 ? message.text.substring(0, 30) + '...' : message.text)
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

  const handleGlobalSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!globalInput.trim() || !selectedColumnId) return;

      const targetCol = columns.find(c => c.id === selectedColumnId);
      if (!targetCol || targetCol.isThinking) return;

      const text = globalInput;
      setGlobalInput('');
      
      const userMsg: Message = {
        id: uuidv4(),
        role: 'user',
        text: text,
        timestamp: Date.now()
      };
      
      addMessageToColumn(selectedColumnId, userMsg);
      setThinking(selectedColumnId, true);
      
      // Auto expand if user types into a collapsed node
      if (targetCol.isCollapsed) {
          handleToggleCollapse(selectedColumnId);
      }

      const modelMsgId = uuidv4();
      const modelMsg: Message = {
        id: modelMsgId,
        role: 'model',
        text: '',
        timestamp: Date.now()
      };
      
      setTimeout(() => {
          addMessageToColumn(selectedColumnId, modelMsg);
          streamGeminiResponse(
            selectedColumnId,
            text,
            columns,
            (chunk) => updateLastMessage(selectedColumnId, chunk)
          ).finally(() => {
            setThinking(selectedColumnId, false);
          });
      }, 100);
  };

  const handleBranch = (sourceColumnId: string, sourceMessageId: string, selectedText: string, customPrompt?: string) => {
    const newColId = uuidv4();
    const newColumn: Column = {
      id: newColId,
      title: customPrompt || selectedText.substring(0, 20) + '...',
      parentId: sourceColumnId,
      parentMessageId: sourceMessageId,
      contextSnippet: selectedText,
      messages: [],
      inputValue: '',
      isThinking: false,
      isCollapsed: false
    };

    setColumns(prev => [...prev, newColumn]);
    setSelectedColumnId(newColId);

    const initialPrompt = customPrompt || `Tell me more about "${selectedText}" in the context of our previous conversation.`;
    
    // Auto-send first message
    setTimeout(() => {
        const userMsg: Message = {
            id: uuidv4(),
            role: 'user',
            text: initialPrompt,
            timestamp: Date.now()
        };
        addMessageToColumn(newColId, userMsg);
        setThinking(newColId, true);
        
        const modelMsgId = uuidv4();
        const modelMsg: Message = {
            id: modelMsgId,
            role: 'model',
            text: '',
            timestamp: Date.now()
        };
        
        setTimeout(() => {
            addMessageToColumn(newColId, modelMsg);
            streamGeminiResponse(
                newColId,
                initialPrompt,
                [...columns, newColumn], 
                (chunk) => updateLastMessage(newColId, chunk)
            ).finally(() => {
                setThinking(newColId, false);
            });
        }, 100);
    }, 100);
  };

  const handleCloseColumn = (columnId: string) => {
    const getDescendants = (id: string): string[] => {
        const children = columns.filter(c => c.parentId === id);
        return [id, ...children.flatMap(c => getDescendants(c.id))];
    };
    const toDelete = new Set(getDescendants(columnId));
    
    setColumns(prev => prev.filter(c => !toDelete.has(c.id)));
    
    // Cleanup heights & offsets
    setNodeHeights(prev => {
        const next = new Map(prev);
        toDelete.forEach(id => next.delete(id));
        return next;
    });
    setNodeOffsets(prev => {
        const next = new Map(prev);
        toDelete.forEach(id => next.delete(id));
        return next;
    });
    
    if (toDelete.has(selectedColumnId)) {
        const col = columns.find(c => c.id === columnId);
        if (col && col.parentId) {
            setSelectedColumnId(col.parentId);
        } else {
            setSelectedColumnId(columns[0].id);
        }
    }
  };
  
  const startSession = (e: React.FormEvent) => {
      e.preventDefault();
      if (!landingInput.trim()) return;
      setHasStarted(true);
      setPan({ x: 0, y: 0 }); // Center root initially
      
      const rootId = columns[0].id;
      
      const userMsg: Message = {
        id: uuidv4(),
        role: 'user',
        text: landingInput,
        timestamp: Date.now()
      };
      addMessageToColumn(rootId, userMsg);
      setThinking(rootId, true);

      const modelMsgId = uuidv4();
      const modelMsg: Message = {
          id: modelMsgId,
          role: 'model',
          text: '',
          timestamp: Date.now()
      };
      
      setTimeout(() => {
          addMessageToColumn(rootId, modelMsg);
          streamGeminiResponse(
              rootId,
              landingInput,
              columns,
              (chunk) => updateLastMessage(rootId, chunk)
          ).finally(() => {
              setThinking(rootId, false);
          });
      }, 100);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-gray-950 text-gray-100 font-sans overflow-hidden">
      
      {/* LANDING VIEW */}
      {!hasStarted ? (
          <div className="flex flex-col items-center justify-center h-full w-full p-4 animate-in fade-in duration-700 bg-dot-pattern">
             <div className="text-center mb-10">
                 <div className="w-20 h-20 bg-gradient-to-tr from-indigo-600 to-purple-500 rounded-2xl mx-auto mb-6 shadow-2xl flex items-center justify-center">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" /></svg>
                 </div>
                 <h1 className="text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400 mb-4">
                     A.I. 思维宇宙
                 </h1>
                 <p className="text-gray-400 text-sm md:text-base">
                     AI 加持，服务<span className="text-pink-500 font-semibold">人类</span>
                 </p>
                 <div className="flex justify-center gap-2 mt-4 text-xs">
                     <button className="px-3 py-1 bg-gray-800 rounded border border-gray-700 hover:border-indigo-500 transition-colors">中文</button>
                     <button className="px-3 py-1 bg-gray-800 rounded border border-gray-700 hover:border-indigo-500 transition-colors">English</button>
                 </div>
             </div>

             <div className="w-full max-w-2xl">
                 <h2 className="text-center text-xl text-gray-300 mb-6 font-medium">今天我们探索什么？</h2>
                 <form onSubmit={startSession} className="relative group">
                     <div className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
                     <input 
                        type="text" 
                        value={landingInput}
                        onChange={(e) => setLandingInput(e.target.value)}
                        placeholder="输入你的问题并回车..." 
                        className="relative w-full bg-gray-900 border border-gray-700 text-white rounded-lg p-5 text-lg shadow-2xl focus:outline-none focus:border-indigo-500 transition-all placeholder-gray-600"
                        autoFocus
                     />
                     <button 
                        type="submit"
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-indigo-400 transition-colors p-2"
                     >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                     </button>
                 </form>
             </div>
          </div>
      ) : (
          /* CANVAS VIEW */
          <>
            <header className="h-14 border-b border-gray-800/50 flex items-center px-6 bg-gray-900/80 backdrop-blur-md shadow-sm z-20 flex-shrink-0 sticky top-0 pointer-events-none">
                <div className="pointer-events-auto flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v19"/><path d="M5 8h14"/><path d="M15 11l-3-3-3 3"/></svg>
                    </div>
                    <span className="font-bold text-lg tracking-tight text-gray-100">DeepDive AI</span>
                    <div className="ml-4 flex items-center gap-2 bg-gray-800/50 rounded-full px-3 py-1 text-xs text-gray-400">
                        <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))} className="hover:text-white">-</button>
                        <span>{Math.round(scale * 100)}%</span>
                        <button onClick={() => setScale(s => Math.min(3, s + 0.1))} className="hover:text-white">+</button>
                    </div>
                </div>
                <div className="ml-auto pointer-events-auto text-xs text-gray-500 flex items-center gap-4">
                    <button onClick={() => {setHasStarted(false); setColumns([columns[0]]); setGlobalInput('')}} className="hover:text-white transition-colors">Reset</button>
                </div>
            </header>

            {/* Minimap */}
            <Minimap 
                layout={layout} 
                nodeOffsets={nodeOffsets} 
                pan={pan} 
                scale={scale} 
                viewportSize={viewportSize} 
            />

            <main 
                ref={viewportRef}
                className="flex-1 overflow-hidden relative cursor-grab active:cursor-grabbing bg-dot-pattern"
                onMouseDown={handleMouseDown}
                onWheel={handleWheel}
                style={{
                  backgroundPosition: `${pan.x}px ${pan.y}px`,
                  backgroundSize: `${24 * scale}px ${24 * scale}px` // Scale grid pattern too
                }}
            >
                {/* Content Container - moves with Pan & Scale */}
                <div 
                  ref={contentRef}
                  className="absolute top-0 left-0 w-0 h-0 transition-transform duration-100 ease-out origin-top-left"
                  style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                >
                    {/* SVG Layer */}
                    <svg className="absolute overflow-visible top-0 left-0 pointer-events-none z-0">
                        {lines.map(line => (
                            <React.Fragment key={line.id}>
                                <path d={line.path} className="connector-path" strokeWidth={2 / scale} />
                                {/* Start Dot (Parent Side) */}
                                <circle cx={line.startX} cy={line.startY} r={4 / scale} className="connector-dot" />
                                {/* End Dot (Child Side) */}
                                <circle cx={line.endX} cy={line.endY} r={4 / scale} className="connector-dot" />
                            </React.Fragment>
                        ))}
                    </svg>

                    {/* Nodes Layer */}
                    {columns.map((col) => {
                        const pos = layout.get(col.id);
                        if (!pos) return null;
                        
                        const offset = nodeOffsets.get(col.id) || {x: 0, y: 0};
                        const finalX = pos.x + offset.x;
                        const finalY = pos.y + offset.y;

                        return (
                            <div 
                                key={col.id} 
                                className="absolute chat-column-container"
                                style={{ 
                                    transform: `translate(${finalX}px, ${finalY - pos.height/2}px)`, 
                                    width: NODE_WIDTH
                                }}
                            >
                                <ChatColumn
                                    column={col}
                                    childColumns={columns}
                                    isActive={selectedColumnId === col.id}
                                    onBranch={handleBranch}
                                    onSelect={setSelectedColumnId}
                                    onClose={col.parentId ? handleCloseColumn : undefined}
                                    onHeightChange={handleNodeResize}
                                    onToggleCollapse={handleToggleCollapse}
                                    onHeaderMouseDown={handleNodeDragStart}
                                />
                            </div>
                        );
                    })}
                </div>
            </main>

            {/* Global Input Bar */}
            <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 w-full max-w-2xl px-4 z-50">
                <form onSubmit={handleGlobalSubmit} className="relative group">
                    <div className={`absolute inset-0 bg-indigo-500 rounded-2xl blur transition duration-500 ${selectedColumnId ? 'opacity-20 group-hover:opacity-30' : 'opacity-0'}`}></div>
                    <input
                        type="text"
                        value={globalInput}
                        onChange={(e) => setGlobalInput(e.target.value)}
                        placeholder={selectedColumnId ? "Type a message to the selected thread..." : "Select a thread to chat"}
                        className="w-full bg-gray-900/90 text-white border border-gray-700 rounded-2xl py-4 px-6 pr-14 text-base focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-2xl backdrop-blur-xl transition-all"
                        disabled={!selectedColumnId}
                    />
                    <button
                        type="submit"
                        disabled={!globalInput.trim() || !selectedColumnId}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                    </button>
                </form>
            </div>
          </>
      )}
    </div>
  );
};

export default App;