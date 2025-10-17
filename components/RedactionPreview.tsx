import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RedactionPage, RedactionRect } from '../types';

interface RedactionPreviewProps {
    pages: RedactionPage[];
    onUpdate: (pages: RedactionPage[]) => void;
    onProceed: () => void;
    onCancel: () => void;
}

export const RedactionPreview: React.FC<RedactionPreviewProps> = ({ pages, onUpdate, onProceed, onCancel }) => {
    const deepCopy = (p: RedactionPage[]): RedactionPage[] => JSON.parse(JSON.stringify(p));
    const [activeTool, setActiveTool] = useState<'draw' | 'erase' | 'select'>('draw');
    const [dragging, setDragging] = useState(false);
    const startRef = useRef<{x:number;y:number}|null>(null);
    const [selected, setSelected] = useState<{pageIdx:number; rectId:string|null}>({pageIdx:0, rectId:null});
    const [zoom, setZoom] = useState<number[]>(() => pages.map(()=>1));
    const [drawOverlay, setDrawOverlay] = useState<null | {pageIdx:number; x:number; y:number; width:number; height:number}>(null);

    // Undo/Redo history
    const [history, setHistory] = useState<RedactionPage[][]>([deepCopy(pages)]);
    const [historyIndex, setHistoryIndex] = useState(0);

    useEffect(() => {
        // Initialize/refresh history when pages prop changes size
        setHistory([deepCopy(pages)]);
        setHistoryIndex(0);
        setZoom(pages.map(()=>1));
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
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && activeTool === 'select' && selected.rectId != null) {
                e.preventDefault();
                const { pageIdx, rectId } = selected;
                const updated = deepCopy(pages);
                updated[pageIdx] = { ...updated[pageIdx], rects: updated[pageIdx].rects.filter(r => r.id !== rectId) };
                setSelected({ pageIdx, rectId: null });
                onUpdate(updated);
                pushHistory(updated);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [historyIndex, history, activeTool, selected, pages]);

    const handleMouseDown = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (activeTool === 'erase') {
            // Click-to-erase: remove top-most rect containing the point
            const canvas = e.currentTarget;
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            const page = pages[pageIdx];
            // Find last added rect that contains the point (top-most)
            for (let i = page.rects.length - 1; i >= 0; i--) {
                const r = page.rects[i];
                if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
                    const updated = deepCopy(pages);
                    const newRects = [...page.rects];
                    newRects.splice(i, 1);
                    updated[pageIdx] = { ...page, rects: newRects };
                    onUpdate(updated);
                    pushHistory(updated);
                    break;
                }
            }
            return;
        }
        if (activeTool !== 'draw') return;
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        startRef.current = { x, y };
        setDragging(true);
        setDrawOverlay({ pageIdx, x, y, width: 0, height: 0 });
    };

    const handleMouseUp = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragging || activeTool !== 'draw' || !startRef.current) return;
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x2 = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y2 = (e.clientY - rect.top) * (canvas.height / rect.height);
        const x = Math.min(startRef.current.x, x2);
        const y = Math.min(startRef.current.y, y2);
        const w = Math.abs(x2 - startRef.current.x);
        const h = Math.abs(y2 - startRef.current.y);
        startRef.current = null;
        setDragging(false);
        setDrawOverlay(null);
        if (w < 4 || h < 4) return; // ignore tiny
        const updated = deepCopy(pages);
        const newRect: RedactionRect = { id: `${pageIdx}-${Date.now()}-${Math.random()}`, x, y, width: w, height: h, source: 'manual' };
        updated[pageIdx] = { ...updated[pageIdx], rects: [...updated[pageIdx].rects, newRect] };
        onUpdate(updated);
        pushHistory(updated);
    };

    const handleEraseClick = (pageIdx: number, rectId: string) => {
        const updated = deepCopy(pages);
        updated[pageIdx] = { ...updated[pageIdx], rects: updated[pageIdx].rects.filter(r => r.id !== rectId) };
        onUpdate(updated);
        pushHistory(updated);
    };

    const drawPage = (canvas: HTMLCanvasElement, page: RedactionPage, selectedRectId?: string, overlayRect?: {x:number;y:number;width:number;height:number}) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            // Draw existing redaction rectangles fully opaque
            ctx.fillStyle = '#000000';
            for (const r of page.rects) {
                ctx.fillRect(r.x, r.y, r.width, r.height);
            }
            // Selection outline and handles
            if (selectedRectId) {
                const sr = page.rects.find(r => r.id === selectedRectId);
                if (sr) {
                    ctx.save();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(sr.x + 0.5, sr.y + 0.5, sr.width - 1, sr.height - 1);
                    const hs = 8; // handle size
                    ctx.fillStyle = '#ffffff';
                    // corners
                    ctx.fillRect(sr.x - hs/2, sr.y - hs/2, hs, hs);
                    ctx.fillRect(sr.x + sr.width - hs/2, sr.y - hs/2, hs, hs);
                    ctx.fillRect(sr.x - hs/2, sr.y + sr.height - hs/2, hs, hs);
                    ctx.fillRect(sr.x + sr.width - hs/2, sr.y + sr.height - hs/2, hs, hs);
                    ctx.restore();
                }
            }
            // Draw overlay (current drawing rectangle) as fully opaque fill with solid black border
            if (overlayRect && overlayRect.width >= 2 && overlayRect.height >= 2) {
                ctx.save();
                // Fill the drawing area so nothing underneath is visible
                ctx.fillStyle = '#000000';
                ctx.fillRect(overlayRect.x, overlayRect.y, overlayRect.width, overlayRect.height);
                // Border for clarity while drawing
                ctx.setLineDash([]);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.strokeRect(overlayRect.x + 0.5, overlayRect.y + 0.5, overlayRect.width - 1, overlayRect.height - 1);
                ctx.restore();
            }
        };
        img.src = page.baseImage;
    };

    // Select/Move/Resize interactions
    const dragState = useRef<null | { action: 'move' | 'resize'; pageIdx: number; rectId: string; startX: number; startY: number; orig: RedactionRect; corner?: 'nw'|'ne'|'sw'|'se'; snapshot: RedactionPage[]; lastPages?: RedactionPage[] }>(null);

    const hitTestCorner = (r: RedactionRect, x: number, y: number, tol = 10): undefined | 'nw' | 'ne' | 'sw' | 'se' => {
        const corners: Array<{cx:number; cy:number; name:'nw'|'ne'|'sw'|'se'}> = [
            {cx:r.x, cy:r.y, name:'nw'},
            {cx:r.x + r.width, cy:r.y, name:'ne'},
            {cx:r.x, cy:r.y + r.height, name:'sw'},
            {cx:r.x + r.width, cy:r.y + r.height, name:'se'},
        ];
        for (const c of corners) {
            if (Math.abs(x - c.cx) <= tol && Math.abs(y - c.cy) <= tol) return c.name;
        }
        return undefined;
    };

    const handleMouseMove = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragState.current) return;
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const ds = dragState.current;
        const dx = x - ds.startX;
        const dy = y - ds.startY;
    const pagesCopy = deepCopy(pages);
        const page = pagesCopy[ds.pageIdx];
        const idx = page.rects.findIndex(r => r.id === ds.rectId);
        if (idx === -1) return;
        let r = { ...page.rects[idx] };
        if (ds.action === 'move') {
            r.x = ds.orig.x + dx;
            r.y = ds.orig.y + dy;
        } else {
            // resize by corner
            const corner = ds.corner!;
            if (corner === 'nw') {
                const newX = ds.orig.x + dx;
                const newY = ds.orig.y + dy;
                r.width = ds.orig.width + (ds.orig.x - newX);
                r.height = ds.orig.height + (ds.orig.y - newY);
                r.x = newX;
                r.y = newY;
            } else if (corner === 'ne') {
                const newY = ds.orig.y + dy;
                r.width = ds.orig.width + dx;
                r.height = ds.orig.height + (ds.orig.y - newY);
                r.y = newY;
            } else if (corner === 'sw') {
                const newX = ds.orig.x + dx;
                r.width = ds.orig.width + (ds.orig.x - newX);
                r.height = ds.orig.height + dy;
                r.x = newX;
            } else if (corner === 'se') {
                r.width = ds.orig.width + dx;
                r.height = ds.orig.height + dy;
            }
            // normalize minimal size
            // If width/height flipped negative, normalize to keep x,y top-left
            if (r.width < 0) { r.x = r.x + r.width; r.width = Math.abs(r.width); }
            if (r.height < 0) { r.y = r.y + r.height; r.height = Math.abs(r.height); }
            r.width = Math.max(4, r.width);
            r.height = Math.max(4, r.height);
        }
        page.rects[idx] = r;
        onUpdate(pagesCopy);
        ds.lastPages = pagesCopy;

        // Dynamic cursor feedback in select mode
        if (activeTool === 'select') {
            const corner = hitTestCorner(r, x, y);
            if (corner === 'nw' || corner === 'se') canvas.style.cursor = 'nwse-resize';
            else if (corner === 'ne' || corner === 'sw') canvas.style.cursor = 'nesw-resize';
            else if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) canvas.style.cursor = 'move';
            else canvas.style.cursor = 'default';
        }
    };

    // Hover feedback when not dragging
    const handleHoverMove = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (dragState.current) return; // drag handler already updates cursor
        if (activeTool !== 'select') return;
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        const page = pages[pageIdx];
        for (let i = page.rects.length - 1; i >= 0; i--) {
            const r = page.rects[i];
            const corner = hitTestCorner(r, x, y);
            if (corner === 'nw' || corner === 'se') { canvas.style.cursor = 'nwse-resize'; return; }
            if (corner === 'ne' || corner === 'sw') { canvas.style.cursor = 'nesw-resize'; return; }
            if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) { canvas.style.cursor = 'move'; return; }
        }
        canvas.style.cursor = 'default';
    };

    const handleSelectMouseDown = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y = (e.clientY - rect.top) * (canvas.height / rect.height);
        const page = pages[pageIdx];
        // top-most rect first
        for (let i = page.rects.length - 1; i >= 0; i--) {
            const r = page.rects[i];
            const corner = hitTestCorner(r, x, y);
            if (corner) {
                setSelected({pageIdx, rectId: r.id});
                dragState.current = { action: 'resize', pageIdx, rectId: r.id, startX:x, startY:y, orig: {...r}, corner, snapshot: deepCopy(pages) };
                return;
            }
            if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
                setSelected({pageIdx, rectId: r.id});
                dragState.current = { action: 'move', pageIdx, rectId: r.id, startX:x, startY:y, orig: {...r}, snapshot: deepCopy(pages) } as any;
                return;
            }
        }
        // click empty area clears selection
        setSelected({pageIdx, rectId: null});
    };

    const handleCanvasMouseDown = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (activeTool === 'select') return handleSelectMouseDown(pageIdx, e);
        return handleMouseDown(pageIdx, e);
    };

    const handleCanvasMouseUp = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (activeTool === 'select') {
            if (dragState.current) {
                const ds = dragState.current;
                const snapshot = ds.lastPages ? deepCopy(ds.lastPages) : deepCopy(pages);
                pushHistory(snapshot);
                dragState.current = null;
            }
            return;
        }
        return handleMouseUp(pageIdx, e);
    };

    const handleCanvasMouseLeave = (pageIdx: number) => {
        if (dragState.current) {
            const ds = dragState.current;
            const snapshot = ds.lastPages ? deepCopy(ds.lastPages) : deepCopy(pages);
            pushHistory(snapshot);
            dragState.current = null;
        }
        // cancel draw overlay if user leaves while drawing
        if (dragging && activeTool === 'draw') {
            setDrawOverlay(null);
            setDragging(false);
            startRef.current = null;
        }
    };

    const handleDrawMouseMove = (pageIdx: number, e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragging || activeTool !== 'draw' || !startRef.current) return;
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x2 = (e.clientX - rect.left) * (canvas.width / rect.width);
        const y2 = (e.clientY - rect.top) * (canvas.height / rect.height);
        const x = Math.min(startRef.current.x, x2);
        const y = Math.min(startRef.current.y, y2);
        const w = Math.abs(x2 - startRef.current.x);
        const h = Math.abs(y2 - startRef.current.y);
        setDrawOverlay({ pageIdx, x, y, width: w, height: h });
    };

    const handleClearPage = (pageIdx: number) => {
        const updated = deepCopy(pages);
        updated[pageIdx] = { ...updated[pageIdx], rects: [] };
        onUpdate(updated);
        pushHistory(updated);
    };

    return (
        <div className="w-full">
            <div className="bg-white rounded-lg border-2 border-gray-300 p-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">
                    🎭 Redaction Preview
                </h2>
                <p className="text-gray-600 mb-2">
                    Review and edit redactions. Use Draw to add boxes, Erase to remove incorrect ones.
                </p>
                <p className="text-xs text-gray-500 mb-4">
                    You are editing the converted images (rendered from your PDF). When you click Proceed, the current boxes are baked into those images and only then sent to AI.
                </p>
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <span className="text-sm text-gray-700">Tool:</span>
                    <button onClick={() => setActiveTool('draw')} className={`px-3 py-1 rounded border ${activeTool==='draw'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300'}`}>Draw</button>
                    <button onClick={() => setActiveTool('erase')} className={`px-3 py-1 rounded border ${activeTool==='erase'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300'}`}>Erase</button>
                    <button onClick={() => setActiveTool('select')} className={`px-3 py-1 rounded border ${activeTool==='select'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300'}`}>Select/Move</button>
                    <span className="ml-auto flex items-center gap-2">
                        <button disabled={!canUndo} onClick={undo} className={`px-3 py-1 rounded border ${canUndo?'bg-white hover:bg-gray-100':'bg-gray-100 text-gray-400'} border-gray-300`}>Undo</button>
                        <button disabled={!canRedo} onClick={redo} className={`px-3 py-1 rounded border ${canRedo?'bg-white hover:bg-gray-100':'bg-gray-100 text-gray-400'} border-gray-300`}>Redo</button>
                    </span>
                </div>
                
                {/* Image preview grid */}
                <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <div className="space-y-4">
                        {pages.map((page, idx) => (
                            <div key={idx} className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                                <div className="bg-gray-100 px-3 py-2 border-b border-gray-300">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-semibold text-gray-700">Page {idx + 1}</span>
                                        <div className="flex items-center gap-3">
                                            <label className="text-xs text-gray-600">Zoom</label>
                                            <input type="range" min={50} max={200} value={Math.round((zoom[idx]||1)*100)} onChange={(e)=>{
                                                const z = Math.max(0.5, Math.min(2, Number(e.target.value)/100));
                                                const arr = [...zoom];
                                                arr[idx] = z; setZoom(arr);
                                            }} />
                                            <button onClick={()=>handleClearPage(idx)} className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-100">Clear page boxes</button>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-2">
                                    <div className="relative" style={{transform:`scale(${zoom[idx]||1})`, transformOrigin: 'top left'}}>
                                        <CanvasWithRects page={page} cursor={activeTool==='draw' ? 'crosshair' : activeTool==='select' ? 'default' : 'pointer'} onRedraw={(c)=>drawPage(c, page, selected.pageIdx===idx?selected.rectId||undefined:undefined, (drawOverlay && drawOverlay.pageIdx===idx) ? {x:drawOverlay.x,y:drawOverlay.y,width:drawOverlay.width,height:drawOverlay.height}: undefined)} onMouseDown={(e)=>handleCanvasMouseDown(idx,e)} onMouseUp={(e)=>handleCanvasMouseUp(idx,e)} onMouseMove={(e)=>{ handleMouseMove(idx,e); handleHoverMove(idx,e); if (activeTool==='draw') handleDrawMouseMove(idx,e); }} onMouseLeave={()=>handleCanvasMouseLeave(idx)} />
                                    </div>
                                    {/* Rect list for erasing */}
                                    {activeTool==='erase' && (
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                            {page.rects.map(r => (
                                                <button key={r.id} onClick={() => handleEraseClick(idx, r.id)} className="px-2 py-1 border rounded bg-white hover:bg-gray-100">
                                                    Remove {r.source} box
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Action buttons */}
                <div className="mt-6 flex flex-col sm:flex-row gap-4">
                    <button
                        onClick={onProceed}
                        className="flex-1 flex items-center justify-center px-6 py-3 font-semibold text-white bg-primary rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-200"
                    >
                        ✓ Looks Good - Proceed with AI Extraction
                    </button>
                    <button
                        onClick={onCancel}
                        className="flex-1 px-6 py-3 font-semibold text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors duration-200"
                    >
                        Cancel
                    </button>
                </div>

                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm text-blue-800">
                        <strong>ℹ️ Note:</strong> Only the redacted version will be sent to Google's Gemini AI. 
                        Your original PDF remains on your device.
                    </p>
                </div>
            </div>
        </div>
    );
};

const CanvasWithRects: React.FC<{ page: RedactionPage; cursor?: string; onRedraw: (canvas: HTMLCanvasElement)=>void; onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>)=>void; onMouseUp: (e: React.MouseEvent<HTMLCanvasElement>)=>void; onMouseMove?: (e: React.MouseEvent<HTMLCanvasElement>)=>void; onMouseLeave?: ()=>void; }>
    = ({ page, cursor, onRedraw, onMouseDown, onMouseUp, onMouseMove, onMouseLeave }) => {
    const ref = useRef<HTMLCanvasElement|null>(null);
    useEffect(() => {
        if (ref.current) onRedraw(ref.current);
    }, [page.baseImage, page.rects]);
    return <canvas ref={ref} className="w-full h-auto" style={{cursor: cursor||'crosshair'}} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} />
}
