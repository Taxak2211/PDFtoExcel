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
    const [zoomOnly, setZoomOnly] = useState<boolean>(false);
    const [dragging, setDragging] = useState(false);
    const startRef = useRef<{x:number;y:number}|null>(null);
    const [selected, setSelected] = useState<{pageIdx:number; rectId:string|null}>({pageIdx:0, rectId:null});
    const [zoom, setZoom] = useState<number[]>(() => pages.map(()=>1));
    const [drawOverlay, setDrawOverlay] = useState<null | {pageIdx:number; x:number; y:number; width:number; height:number}>(null);
    const containerRefs = useRef<Array<HTMLDivElement|null>>([]);
    const pinchRef = useRef<null | { pageIdx:number; lastZoom:number; startDist:number; startZoom:number; startScrollLeft:number; startScrollTop:number }>(null);
    const panRef = useRef<null | { pageIdx:number; startX:number; startY:number; startScrollLeft:number; startScrollTop:number }>(null);

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

    // --- Touch support for mobile ---
    const handleCanvasTouchStart = (pageIdx: number, e: React.TouchEvent<HTMLCanvasElement>) => {
        if (zoomOnly) { return; }
        if (pinchRef.current) return; // ignore while pinching
        if (!e.touches || e.touches.length === 0) return;
        const touch = e.touches[0];
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = (touch.clientX - rect.left) * (canvas.width / rect.width);
        const y = (touch.clientY - rect.top) * (canvas.height / rect.height);
        e.preventDefault();
        if (activeTool === 'erase') {
            // Same logic as click-to-erase
            const page = pages[pageIdx];
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
        if (activeTool === 'select') {
            // mimic select mousedown
            const page = pages[pageIdx];
            for (let i = page.rects.length - 1; i >= 0; i--) {
                const r = page.rects[i];
                const corner = hitTestCorner(r, x, y);
                if (corner) {
                    setSelected({ pageIdx, rectId: r.id });
                    dragState.current = { action: 'resize', pageIdx, rectId: r.id, startX: x, startY: y, orig: { ...r }, corner, snapshot: deepCopy(pages) };
                    return;
                }
                if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
                    setSelected({ pageIdx, rectId: r.id });
                    dragState.current = { action: 'move', pageIdx, rectId: r.id, startX: x, startY: y, orig: { ...r }, snapshot: deepCopy(pages) } as any;
                    return;
                }
            }
            setSelected({ pageIdx, rectId: null });
            return;
        }
        // draw start
        startRef.current = { x, y };
        setDragging(true);
        setDrawOverlay({ pageIdx, x, y, width: 0, height: 0 });
    };

    const handleCanvasTouchMove = (pageIdx: number, e: React.TouchEvent<HTMLCanvasElement>) => {
        if (zoomOnly) { return; }
        if (pinchRef.current) return; // ignore while pinching
        if (!e.touches || e.touches.length === 0) return;
        const touch = e.touches[0];
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const x = (touch.clientX - rect.left) * (canvas.width / rect.width);
        const y = (touch.clientY - rect.top) * (canvas.height / rect.height);
        e.preventDefault();
        if (activeTool === 'draw' && dragging && startRef.current) {
            const x2 = x;
            const y2 = y;
            const sx = startRef.current.x;
            const sy = startRef.current.y;
            const nx = Math.min(sx, x2);
            const ny = Math.min(sy, y2);
            const w = Math.abs(x2 - sx);
            const h = Math.abs(y2 - sy);
            setDrawOverlay({ pageIdx, x: nx, y: ny, width: w, height: h });
            return;
        }
        if (activeTool === 'select' && dragState.current) {
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
                if (r.width < 0) { r.x = r.x + r.width; r.width = Math.abs(r.width); }
                if (r.height < 0) { r.y = r.y + r.height; r.height = Math.abs(r.height); }
                r.width = Math.max(4, r.width);
                r.height = Math.max(4, r.height);
            }
            page.rects[idx] = r;
            onUpdate(pagesCopy);
            ds.lastPages = pagesCopy;
            return;
        }
    };

    const handleCanvasTouchEnd = (pageIdx: number, e: React.TouchEvent<HTMLCanvasElement>) => {
        if (zoomOnly) { return; }
        if (pinchRef.current) return; // ignore while pinching
        e.preventDefault();
        if (activeTool === 'select') {
            if (dragState.current) {
                const ds = dragState.current;
                const snapshot = ds.lastPages ? deepCopy(ds.lastPages) : deepCopy(pages);
                pushHistory(snapshot);
                dragState.current = null;
            }
            return;
        }
        if (!dragging || activeTool !== 'draw' || !startRef.current) return;
        const canvas = e.currentTarget;
        const rect = canvas.getBoundingClientRect();
        // Use changedTouches for end
        const touch = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : (e.touches[0] || null);
        if (!touch) return;
        const x2 = (touch.clientX - rect.left) * (canvas.width / rect.width);
        const y2 = (touch.clientY - rect.top) * (canvas.height / rect.height);
        const x = Math.min(startRef.current.x, x2);
        const y = Math.min(startRef.current.y, y2);
        const w = Math.abs(x2 - startRef.current.x);
        const h = Math.abs(y2 - startRef.current.y);
        startRef.current = null;
        setDragging(false);
        setDrawOverlay(null);
        if (w < 4 || h < 4) return;
        const updated = deepCopy(pages);
        const newRect: RedactionRect = { id: `${pageIdx}-${Date.now()}-${Math.random()}`, x, y, width: w, height: h, source: 'manual' };
        updated[pageIdx] = { ...updated[pageIdx], rects: [...updated[pageIdx].rects, newRect] };
        onUpdate(updated);
        pushHistory(updated);
    };

    const handleCanvasTouchCancel = (pageIdx: number) => {
        if (zoomOnly) { return; }
        if (pinchRef.current) return; // ignore while pinching
        if (dragState.current) {
            const ds = dragState.current;
            const snapshot = ds.lastPages ? deepCopy(ds.lastPages) : deepCopy(pages);
            pushHistory(snapshot);
            dragState.current = null;
        }
        if (dragging && activeTool === 'draw') {
            setDrawOverlay(null);
            setDragging(false);
            startRef.current = null;
        }
    };

    // Pinch zoom on the scroll container (two fingers) keeps focal under fingers
    const handleContainerTouchStart = (pageIdx:number, e: React.TouchEvent<HTMLDivElement>) => {
        if (e.touches.length === 2) {
            const [t1, t2] = [e.touches[0], e.touches[1]];
            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            const dist = Math.hypot(dx, dy);
            pinchRef.current = {
                pageIdx,
                lastZoom: zoom[pageIdx] || 1,
                startDist: dist,
                startZoom: zoom[pageIdx] || 1,
                startScrollLeft: containerRefs.current[pageIdx]?.scrollLeft || 0,
                startScrollTop: containerRefs.current[pageIdx]?.scrollTop || 0,
            };
            e.preventDefault();
            // cancel any draw/select gesture if starting a pinch
            if (dragging) { setDragging(false); setDrawOverlay(null); startRef.current = null; }
            dragState.current = null;
            return;
        }
        // In zoom-only mode, start one-finger panning on container
        if (zoomOnly && e.touches.length === 1) {
            const t = e.touches[0];
            const container = containerRefs.current[pageIdx];
            if (!container) return;
            panRef.current = {
                pageIdx,
                startX: t.clientX,
                startY: t.clientY,
                startScrollLeft: container.scrollLeft,
                startScrollTop: container.scrollTop,
            };
            e.preventDefault();
            // Ensure any drawing is canceled
            if (dragging) { setDragging(false); setDrawOverlay(null); startRef.current = null; }
            dragState.current = null;
        }
    };

    const handleContainerTouchMove = (pageIdx:number, e: React.TouchEvent<HTMLDivElement>) => {
        const pr = pinchRef.current;
        const container = containerRefs.current[pageIdx];
        if (!container) return;
        // Handle pinch-to-zoom when two fingers active
        if (pr && pr.pageIdx === pageIdx && e.touches.length >= 2) {
            const [t1, t2] = [e.touches[0], e.touches[1]];
            const rect = container.getBoundingClientRect();
            const midX = ((t1.clientX + t2.clientX) / 2) - rect.left;
            const midY = ((t1.clientY + t2.clientY) / 2) - rect.top;
            const dx = t2.clientX - t1.clientX;
            const dy = t2.clientY - t1.clientY;
            const dist = Math.hypot(dx, dy);
        const factor = dist / pr.startDist;
        const newZoom = Math.max(0.1, Math.min(3, pr.startZoom * factor));
            // compute content coordinate under current midpoint using lastZoom
            const contentX = (container.scrollLeft + midX) / pr.lastZoom;
            const contentY = (container.scrollTop + midY) / pr.lastZoom;
            // update zoom state
            setZoom(prev => {
                const arr = [...prev];
                arr[pageIdx] = newZoom;
                return arr;
            });
            // after zoom change, aim to keep same content point under the fingers
            const desiredScrollLeft = contentX * newZoom - midX;
            const desiredScrollTop = contentY * newZoom - midY;
            // clamp
            const maxScrollLeft = Math.max(0, (container.scrollWidth - container.clientWidth));
            const maxScrollTop = Math.max(0, (container.scrollHeight - container.clientHeight));
            container.scrollLeft = Math.max(0, Math.min(desiredScrollLeft, maxScrollLeft));
            container.scrollTop = Math.max(0, Math.min(desiredScrollTop, maxScrollTop));
            pinchRef.current = { ...pr, lastZoom: newZoom };
            e.preventDefault();
            return;
        }
        // Handle one-finger pan when zoomOnly
        const pan = panRef.current;
        if (zoomOnly && pan && pan.pageIdx === pageIdx && e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - pan.startX;
            const dy = t.clientY - pan.startY;
            container.scrollLeft = pan.startScrollLeft - dx;
            container.scrollTop = pan.startScrollTop - dy;
            e.preventDefault();
            return;
        }
    };

    const handleContainerTouchEnd = (pageIdx:number, e: React.TouchEvent<HTMLDivElement>) => {
        if (pinchRef.current && e.touches.length < 2) {
            pinchRef.current = null;
        }
        if (panRef.current && e.touches.length < 1) {
            panRef.current = null;
        }
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
                    <button
                        onClick={() => {
                            setZoomOnly(z => {
                                const next = !z;
                                // cancel any ongoing interactions when toggling
                                if (next) {
                                    if (dragState.current) dragState.current = null;
                                    if (dragging) { setDragging(false); setDrawOverlay(null); startRef.current = null; }
                                }
                                return next;
                            });
                        }}
                        className={`px-3 py-1 rounded border ${zoomOnly ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                        title="Zoom and pan only; disable drawing and selection"
                    >
                        Zoom Only
                    </button>
                    <span className="text-sm text-gray-700">Tool:</span>
                    <button onClick={() => setActiveTool('draw')} className={`px-3 py-1 rounded border ${activeTool==='draw'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300'}`}>Draw</button>
                    <button onClick={() => setActiveTool('erase')} className={`px-3 py-1 rounded border ${activeTool==='erase'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300'}`}>Erase</button>
                    <button onClick={() => setActiveTool('select')} className={`px-3 py-1 rounded border ${activeTool==='select'?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-700 border-gray-300'}`}>Select/Move</button>
                    <button
                        onClick={() => {
                            if (confirm('Erase all boxes on all pages? This can be undone with Undo.')) {
                                const cleared = pages.map(p => ({ ...p, rects: [] as RedactionRect[] }));
                                onUpdate(cleared);
                                pushHistory(cleared);
                                setSelected({ pageIdx: 0, rectId: null });
                            }
                        }}
                        className="px-3 py-1 rounded border bg-white text-red-700 border-red-300 hover:bg-red-50"
                        title="Remove all boxes across all pages"
                    >
                        Erase All Boxes
                    </button>
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
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                        <span className="text-sm font-semibold text-gray-700">Page {idx + 1}</span>
                                        <div className="hidden sm:flex items-center gap-3">
                                            <label className="text-xs text-gray-600">Zoom</label>
                                            <input type="range" min={10} max={300} value={Math.round((zoom[idx]||1)*100)} onChange={(e)=>{
                                                const z = Math.max(0.1, Math.min(3, Number(e.target.value)/100));
                                                const arr = [...zoom];
                                                arr[idx] = z; setZoom(arr);
                                            }} />
                                            <button onClick={()=>handleClearPage(idx)} className="px-2 py-1 text-xs border rounded bg-white hover:bg-gray-100 hidden sm:inline-flex">Clear page boxes</button>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-2">
                                    <div 
                                        className="relative overflow-auto max-w-full"
                                        ref={(el)=>{ containerRefs.current[idx] = el; }}
                                        onTouchStart={(e)=>handleContainerTouchStart(idx, e)}
                                        onTouchMove={(e)=>handleContainerTouchMove(idx, e)}
                                        onTouchEnd={(e)=>handleContainerTouchEnd(idx, e)}
                                        onTouchCancel={(e)=>handleContainerTouchEnd(idx, e)}
                                        style={{ touchAction: 'none' }}
                                    >
                                        <CanvasWithRects
                                            page={page}
                                            cursor={zoomOnly ? 'zoom-in' : (activeTool==='draw' ? 'crosshair' : activeTool==='select' ? 'default' : 'pointer')}
                                            zoom={zoom[idx]||1}
                                            onRedraw={(c)=>drawPage(c, page, selected.pageIdx===idx?selected.rectId||undefined:undefined, (drawOverlay && drawOverlay.pageIdx===idx) ? {x:drawOverlay.x,y:drawOverlay.y,width:drawOverlay.width,height:drawOverlay.height}: undefined)}
                                            onMouseDown={zoomOnly ? undefined as any : (e)=>handleCanvasMouseDown(idx,e)}
                                            onMouseUp={zoomOnly ? undefined as any : (e)=>handleCanvasMouseUp(idx,e)}
                                            onMouseMove={zoomOnly ? undefined as any : (e)=>{ handleMouseMove(idx,e); handleHoverMove(idx,e); if (activeTool==='draw') handleDrawMouseMove(idx,e); }}
                                            onMouseLeave={zoomOnly ? undefined as any : ()=>handleCanvasMouseLeave(idx)}
                                            onTouchStart={zoomOnly ? undefined as any : (e)=>handleCanvasTouchStart(idx, e)}
                                            onTouchMove={zoomOnly ? undefined as any : (e)=>handleCanvasTouchMove(idx, e)}
                                            onTouchEnd={zoomOnly ? undefined as any : (e)=>handleCanvasTouchEnd(idx, e)}
                                            onTouchCancel={zoomOnly ? undefined as any : ()=>handleCanvasTouchCancel(idx)}
                                        />
                                    </div>
                                    {/* Mobile clear button */}
                                    <div className="mt-2 sm:hidden">
                                        <button onClick={()=>handleClearPage(idx)} className="w-full px-2 py-2 text-xs border rounded bg-white hover:bg-gray-100">Clear page boxes</button>
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

const CanvasWithRects: React.FC<{ 
    page: RedactionPage; 
    cursor?: string; 
    zoom?: number;
    onRedraw: (canvas: HTMLCanvasElement)=>void; 
    onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>)=>void; 
    onMouseUp: (e: React.MouseEvent<HTMLCanvasElement>)=>void; 
    onMouseMove?: (e: React.MouseEvent<HTMLCanvasElement>)=>void; 
    onMouseLeave?: ()=>void;
    onTouchStart?: (e: React.TouchEvent<HTMLCanvasElement>)=>void;
    onTouchMove?: (e: React.TouchEvent<HTMLCanvasElement>)=>void;
    onTouchEnd?: (e: React.TouchEvent<HTMLCanvasElement>)=>void;
    onTouchCancel?: ()=>void;
}>
    = ({ page, cursor, zoom, onRedraw, onMouseDown, onMouseUp, onMouseMove, onMouseLeave, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }) => {
    const ref = useRef<HTMLCanvasElement|null>(null);
    useEffect(() => {
        if (ref.current) onRedraw(ref.current);
    }, [page.baseImage, page.rects]);
    useEffect(() => {
        if (!ref.current) return;
        const c = ref.current;
        const applySize = () => {
            const z = zoom || 1;
            if (c.width && c.height) {
                c.style.width = `${Math.round(c.width * z)}px`;
                c.style.height = `${Math.round(c.height * z)}px`;
            }
        };
        // Apply immediately and on next frame to catch after image draw sets intrinsic size
        applySize();
        const id = requestAnimationFrame(applySize);
        return () => cancelAnimationFrame(id);
    }, [zoom, page.baseImage]);
    return <canvas 
        ref={ref} 
        className="w-full h-auto" 
        style={{cursor: cursor||'crosshair', touchAction: 'none'}} 
        onMouseDown={onMouseDown} 
        onMouseUp={onMouseUp} 
        onMouseMove={onMouseMove} 
        onMouseLeave={onMouseLeave}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
    />
}
