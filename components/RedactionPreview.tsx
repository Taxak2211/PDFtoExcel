import React, { useEffect, useRef, useState, useCallback } from 'react';
import { RedactionPage, RedactionRect } from '../types';

interface RedactionPreviewProps {
    pages: RedactionPage[];
    onUpdate: (pages: RedactionPage[]) => void;
    onProceed: () => void;
    onCancel: () => void;
}

export const RedactionPreview: React.FC<RedactionPreviewProps> = ({ pages, onUpdate, onProceed, onCancel }) => {
    const deepCopy = (p: RedactionPage[]): RedactionPage[] => JSON.parse(JSON.stringify(p));
    const [activeTool, setActiveTool] = useState<'draw' | 'erase' | 'pan'>('pan');
    const [dragging, setDragging] = useState(false);
    const startRef = useRef<{x:number;y:number}|null>(null);
    const [currentPage, setCurrentPage] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [drawOverlay, setDrawOverlay] = useState<null | {x:number; y:number; width:number; height:number}>(null);
    const containerRef = useRef<HTMLDivElement|null>(null);
    const canvasRef = useRef<HTMLCanvasElement|null>(null);
    const pinchRef = useRef<null | { lastZoom:number; startDist:number; startZoom:number }>(null);
    const panRef = useRef<null | { startX:number; startY:number; startScrollLeft:number; startScrollTop:number }>(null);

    // Undo/Redo history
    const [history, setHistory] = useState<RedactionPage[][]>([deepCopy(pages)]);
    const [historyIndex, setHistoryIndex] = useState(0);

    useEffect(() => {
        setHistory([deepCopy(pages)]);
        setHistoryIndex(0);
    }, [pages.length]);

    const pushHistory = (newPages: RedactionPage[]) => {
        const copy = deepCopy(newPages);
        const next = history.slice(0, historyIndex + 1).concat([copy]);
        setHistory(next);
        setHistoryIndex(next.length - 1);
    };

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const undo = () => {
        if (!canUndo) return;
        const idx = historyIndex - 1;
        setHistoryIndex(idx);
        onUpdate(deepCopy(history[idx]));
    };
    
    const redo = () => {
        if (!canRedo) return;
        const idx = historyIndex + 1;
        setHistoryIndex(idx);
        onUpdate(deepCopy(history[idx]));
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const isMac = navigator.platform.toLowerCase().includes('mac');
            const mod = isMac ? e.metaKey : e.ctrlKey;
            if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                undo();
            } else if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) {
                e.preventDefault();
                redo();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [historyIndex, history]);

    // Draw the current page
    const drawPage = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || !pages[currentPage]) return;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const page = pages[currentPage];
        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            // Draw redaction rectangles
            ctx.fillStyle = '#000000';
            for (const r of page.rects) {
                ctx.fillRect(r.x, r.y, r.width, r.height);
            }
            
            // Draw overlay if drawing
            if (drawOverlay && drawOverlay.width >= 2 && drawOverlay.height >= 2) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(drawOverlay.x, drawOverlay.y, drawOverlay.width, drawOverlay.height);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.strokeRect(drawOverlay.x + 0.5, drawOverlay.y + 0.5, drawOverlay.width - 1, drawOverlay.height - 1);
            }
            
            // Apply zoom
            canvas.style.width = `${Math.round(canvas.width * zoom)}px`;
            canvas.style.height = `${Math.round(canvas.height * zoom)}px`;
        };
        img.src = page.baseImage;
    }, [pages, currentPage, zoom, drawOverlay]);

    useEffect(() => {
        drawPage();
    }, [drawPage]);

    // Get canvas coordinates from event
    const getCanvasCoords = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) * (canvas.width / rect.width),
            y: (clientY - rect.top) * (canvas.height / rect.height)
        };
    };

    // Mouse handlers
    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const { x, y } = getCanvasCoords(e.clientX, e.clientY);
        
        if (activeTool === 'erase') {
            const page = pages[currentPage];
            for (let i = page.rects.length - 1; i >= 0; i--) {
                const r = page.rects[i];
                if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
                    const updated = deepCopy(pages);
                    updated[currentPage].rects.splice(i, 1);
                    onUpdate(updated);
                    pushHistory(updated);
                    break;
                }
            }
            return;
        }
        
        if (activeTool === 'draw') {
            startRef.current = { x, y };
            setDragging(true);
            setDrawOverlay({ x, y, width: 0, height: 0 });
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragging || activeTool !== 'draw' || !startRef.current) return;
        const { x, y } = getCanvasCoords(e.clientX, e.clientY);
        const sx = startRef.current.x;
        const sy = startRef.current.y;
        setDrawOverlay({
            x: Math.min(sx, x),
            y: Math.min(sy, y),
            width: Math.abs(x - sx),
            height: Math.abs(y - sy)
        });
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragging || activeTool !== 'draw' || !startRef.current) return;
        const { x, y } = getCanvasCoords(e.clientX, e.clientY);
        const sx = startRef.current.x;
        const sy = startRef.current.y;
        const rx = Math.min(sx, x);
        const ry = Math.min(sy, y);
        const w = Math.abs(x - sx);
        const h = Math.abs(y - sy);
        
        startRef.current = null;
        setDragging(false);
        setDrawOverlay(null);
        
        if (w < 4 || h < 4) return;
        
        const updated = deepCopy(pages);
        const newRect: RedactionRect = {
            id: `${currentPage}-${Date.now()}-${Math.random()}`,
            x: rx, y: ry, width: w, height: h,
            source: 'manual'
        };
        updated[currentPage].rects.push(newRect);
        onUpdate(updated);
        pushHistory(updated);
    };

    // Touch handlers for pinch zoom and pan
    const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length === 2) {
            // Pinch start
            const [t1, t2] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            pinchRef.current = { lastZoom: zoom, startDist: dist, startZoom: zoom };
            e.preventDefault();
            return;
        }
        
        if (activeTool === 'pan' && e.touches.length === 1) {
            const container = containerRef.current;
            if (!container) return;
            const t = e.touches[0];
            panRef.current = {
                startX: t.clientX,
                startY: t.clientY,
                startScrollLeft: container.scrollLeft,
                startScrollTop: container.scrollTop
            };
            e.preventDefault();
        }
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        if (!container) return;
        
        // Handle pinch zoom
        if (pinchRef.current && e.touches.length >= 2) {
            const [t1, t2] = [e.touches[0], e.touches[1]];
            const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const factor = dist / pinchRef.current.startDist;
            const newZoom = Math.max(0.1, Math.min(4, pinchRef.current.startZoom * factor));
            setZoom(newZoom);
            pinchRef.current.lastZoom = newZoom;
            e.preventDefault();
            return;
        }
        
        // Handle pan
        if (panRef.current && activeTool === 'pan' && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - panRef.current.startX;
            const dy = t.clientY - panRef.current.startY;
            container.scrollLeft = panRef.current.startScrollLeft - dx;
            container.scrollTop = panRef.current.startScrollTop - dy;
            e.preventDefault();
        }
    };

    const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length < 2) pinchRef.current = null;
        if (e.touches.length < 1) panRef.current = null;
    };

    // Canvas touch handlers for drawing/erasing
    const handleCanvasTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (activeTool === 'pan') return;
        if (e.touches.length !== 1) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const { x, y } = getCanvasCoords(touch.clientX, touch.clientY);
        
        if (activeTool === 'erase') {
            const page = pages[currentPage];
            for (let i = page.rects.length - 1; i >= 0; i--) {
                const r = page.rects[i];
                if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
                    const updated = deepCopy(pages);
                    updated[currentPage].rects.splice(i, 1);
                    onUpdate(updated);
                    pushHistory(updated);
                    break;
                }
            }
            return;
        }
        
        if (activeTool === 'draw') {
            startRef.current = { x, y };
            setDragging(true);
            setDrawOverlay({ x, y, width: 0, height: 0 });
        }
    };

    const handleCanvasTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (activeTool !== 'draw' || !dragging || !startRef.current) return;
        if (e.touches.length !== 1) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        const { x, y } = getCanvasCoords(touch.clientX, touch.clientY);
        setDrawOverlay({
            x: Math.min(startRef.current.x, x),
            y: Math.min(startRef.current.y, y),
            width: Math.abs(x - startRef.current.x),
            height: Math.abs(y - startRef.current.y)
        });
    };

    const handleCanvasTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (activeTool !== 'draw' || !dragging || !startRef.current) return;
        e.preventDefault();
        
        const touch = e.changedTouches[0];
        if (!touch) return;
        
        const { x, y } = getCanvasCoords(touch.clientX, touch.clientY);
        const sx = startRef.current.x;
        const sy = startRef.current.y;
        const rx = Math.min(sx, x);
        const ry = Math.min(sy, y);
        const w = Math.abs(x - sx);
        const h = Math.abs(y - sy);
        
        startRef.current = null;
        setDragging(false);
        setDrawOverlay(null);
        
        if (w < 4 || h < 4) return;
        
        const updated = deepCopy(pages);
        const newRect: RedactionRect = {
            id: `${currentPage}-${Date.now()}-${Math.random()}`,
            x: rx, y: ry, width: w, height: h,
            source: 'manual'
        };
        updated[currentPage].rects.push(newRect);
        onUpdate(updated);
        pushHistory(updated);
    };

    const clearCurrentPage = () => {
        if (!confirm('Clear all redactions on this page?')) return;
        const updated = deepCopy(pages);
        updated[currentPage].rects = [];
        onUpdate(updated);
        pushHistory(updated);
    };

    const clearAllPages = () => {
        const totalRects = pages.reduce((sum, p) => sum + p.rects.length, 0);
        if (totalRects === 0) return;
        if (!confirm(`Clear all ${totalRects} redactions from all ${pages.length} pages?`)) return;
        const updated = deepCopy(pages);
        updated.forEach(p => p.rects = []);
        onUpdate(updated);
        pushHistory(updated);
    };

    const deleteCurrentPage = () => {
        if (pages.length === 1) {
            alert('Cannot delete the last page. At least one page is required.');
            return;
        }
        if (!confirm(`Delete page ${currentPage + 1}? This cannot be undone.`)) return;
        const updated = deepCopy(pages);
        updated.splice(currentPage, 1);
        onUpdate(updated);
        pushHistory(updated);
        // Adjust current page if we deleted the last page
        if (currentPage >= updated.length) {
            setCurrentPage(updated.length - 1);
        }
    };

    const currentPageRects = pages[currentPage]?.rects.length || 0;
    const totalRects = pages.reduce((sum, p) => sum + p.rects.length, 0);

    return (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
            {/* Top Header Bar */}
            <div className="flex-shrink-0 bg-gray-800 text-white px-3 py-2 flex items-center justify-between" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
                <button
                    onClick={onCancel}
                    className="p-2 -ml-2 hover:bg-gray-700 rounded-lg transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <div className="flex flex-col items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Page {currentPage + 1} of {pages.length}</span>
                        {pages.length > 1 && (
                            <button
                                onClick={deleteCurrentPage}
                                className="p-1 hover:bg-red-600/20 rounded text-red-400 hover:text-red-300 transition-colors"
                                title="Delete this page"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        )}
                    </div>
                    <span className="text-xs text-gray-400">{currentPageRects} redactions</span>
                </div>
                <button
                    onClick={onProceed}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-medium text-sm transition-colors"
                >
                    Done ✓
                </button>
            </div>

            {/* Main Canvas Area - Takes full screen */}
            <div 
                ref={containerRef}
                className="flex-1 overflow-auto bg-gray-900"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                style={{ touchAction: activeTool === 'pan' ? 'none' : 'manipulation' }}
            >
                <div className="min-h-full flex items-center justify-center p-2">
                    <canvas
                        ref={canvasRef}
                        className="max-w-none shadow-2xl"
                        style={{ 
                            cursor: activeTool === 'draw' ? 'crosshair' : activeTool === 'erase' ? 'pointer' : 'grab',
                            touchAction: 'none'
                        }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={() => { setDragging(false); setDrawOverlay(null); }}
                        onTouchStart={handleCanvasTouchStart}
                        onTouchMove={handleCanvasTouchMove}
                        onTouchEnd={handleCanvasTouchEnd}
                    />
                </div>
            </div>

            {/* Page Navigation (if multiple pages) */}
            {pages.length > 1 && (
                <div className="flex-shrink-0 bg-gray-800 px-4 py-2 flex items-center justify-center gap-2 border-t border-gray-700">
                    <button
                        onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="flex gap-1 overflow-x-auto max-w-[60vw] px-2">
                        {pages.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => setCurrentPage(idx)}
                                className={`min-w-[2rem] w-8 h-8 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                                    idx === currentPage 
                                        ? 'bg-blue-600 text-white' 
                                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`}
                            >
                                {idx + 1}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(pages.length - 1, p + 1))}
                        disabled={currentPage === pages.length - 1}
                        className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
            )}

            {/* Bottom Toolbar */}
            <div className="flex-shrink-0 bg-gray-800 border-t border-gray-700" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
                {/* Zoom Controls */}
                <div className="px-3 py-2 flex items-center justify-between border-b border-gray-700">
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setZoom(z => Math.max(0.1, z - 0.25))}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-lg font-bold transition-colors"
                        >
                            −
                        </button>
                        <span className="text-white text-xs font-medium w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button
                            onClick={() => setZoom(z => Math.min(4, z + 0.25))}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-lg font-bold transition-colors"
                        >
                            +
                        </button>
                        <button
                            onClick={() => setZoom(1)}
                            className="px-2 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium transition-colors ml-1"
                        >
                            100%
                        </button>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={undo}
                            disabled={!canUndo}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-lg transition-colors"
                            title="Undo"
                        >
                            ↩
                        </button>
                        <button
                            onClick={redo}
                            disabled={!canRedo}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-white text-lg transition-colors"
                            title="Redo"
                        >
                            ↪
                        </button>
                        <button
                            onClick={clearCurrentPage}
                            className="w-9 h-9 flex items-center justify-center rounded-lg bg-red-600/30 text-red-400 hover:bg-red-600/40 transition-colors ml-1"
                            title="Clear this page"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                        <button
                            onClick={clearAllPages}
                            disabled={totalRects === 0}
                            className="px-2 h-9 flex items-center justify-center rounded-lg bg-red-600/30 text-red-400 hover:bg-red-600/40 disabled:opacity-40 transition-colors text-xs font-medium"
                            title="Clear all pages"
                        >
                            All
                        </button>
                    </div>
                </div>

                {/* Tool Selection */}
                <div className="px-3 py-2 flex items-center justify-center gap-2">
                    <button
                        onClick={() => setActiveTool('pan')}
                        className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                            activeTool === 'pan'
                                ? 'bg-purple-600 text-white shadow-lg'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
                        </svg>
                        <span className="hidden xs:inline">Pan</span>
                    </button>
                    <button
                        onClick={() => setActiveTool('draw')}
                        className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                            activeTool === 'draw'
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <span className="hidden xs:inline">Draw</span>
                    </button>
                    <button
                        onClick={() => setActiveTool('erase')}
                        className={`flex-1 py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${
                            activeTool === 'erase'
                                ? 'bg-orange-500 text-white shadow-lg'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span className="hidden xs:inline">Erase</span>
                    </button>
                </div>

                {/* Tool Hint */}
                <div className="px-3 pb-2 text-center">
                    <p className="text-xs text-gray-500">
                        {activeTool === 'pan' && 'Drag to pan • Pinch to zoom'}
                        {activeTool === 'draw' && 'Draw rectangles to redact sensitive info'}
                        {activeTool === 'erase' && 'Tap on black boxes to remove them'}
                    </p>
                </div>
            </div>
        </div>
    );
};
