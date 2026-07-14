import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";

export type AnnotationTool = "pen" | "line" | "arrow" | "circle";

export const ANNOTATION_TOOLS: { value: AnnotationTool; label: string }[] = [
  { value: "pen", label: "Pen" },
  { value: "line", label: "Line" },
  { value: "arrow", label: "Arrow" },
  { value: "circle", label: "Circle" },
];

export const ANNOTATION_COLORS = ["#ff5252", "#ffd23f", "#4dd0e1", "#ffffff"] as const;

interface AnnotationPoint {
  x: number;
  y: number;
}

interface AnnotationStroke {
  tool: AnnotationTool;
  color: string;
  points: AnnotationPoint[];
}

export interface UseAnnotationsResult {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  active: boolean;
  setActive: (active: boolean) => void;
  tool: AnnotationTool;
  setTool: (tool: AnnotationTool) => void;
  color: string;
  setColor: (color: string) => void;
  hasStrokesOnFrame: boolean;
  undo: () => void;
  clearFrame: () => void;
  onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLCanvasElement>) => void;
}

function pointFromEvent(e: PointerEvent<HTMLCanvasElement>): AnnotationPoint {
  const rect = e.currentTarget.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: AnnotationStroke, w: number, h: number): void {
  const pts = stroke.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  if (pts.length < 2) return;

  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = Math.max(2, Math.max(w, h) * 0.006);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (stroke.tool === "pen") {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    return;
  }

  const [a, b] = [pts[0], pts[pts.length - 1]];

  if (stroke.tool === "line" || stroke.tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (stroke.tool === "arrow") {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const headLen = Math.max(10, Math.max(w, h) * 0.025);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle - Math.PI / 6), b.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - headLen * Math.cos(angle + Math.PI / 6), b.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }
    return;
  }

  // circle: a/b are opposite corners of the bounding box, matching the
  // familiar "drag a box" gesture other annotation tools use.
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Freehand/shape annotation layer for a video, keyed per pose-frame index so
 * marks made while paused on one moment (e.g. top of backswing) don't bleed
 * into another. Strokes live in a ref (not state) since they can arrive at
 * pointer-move frequency; a small counter forces a re-render after each
 * completed mutation so callers relying on `hasStrokesOnFrame` stay current.
 */
export function useAnnotations(
  frameIndex: number,
  videoRef: RefObject<HTMLVideoElement | null>,
): UseAnnotationsResult {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActiveState] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const strokesByFrame = useRef<Map<number, AnnotationStroke[]>>(new Map());
  const drawingStroke = useRef<AnnotationStroke | null>(null);
  const [version, setVersion] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const strokes = strokesByFrame.current.get(frameIndex) ?? [];
    const pending = drawingStroke.current;
    for (const stroke of pending ? [...strokes, pending] : strokes) drawStroke(ctx, stroke, w, h);
  }, [frameIndex]);

  useEffect(() => {
    redraw();
  }, [redraw, version]);

  // Read by the ResizeObserver below, which must always call the latest
  // redraw without itself depending on it — frameIndex (and so redraw's
  // identity) changes on every video frame during playback, and rebuilding
  // the observer that often would reassign canvas.width/height every frame,
  // forcing a full backing-bitmap reallocation many times a second.
  const redrawRef = useRef(redraw);
  redrawRef.current = redraw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redrawRef.current();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const setActive = useCallback(
    (next: boolean) => {
      setActiveState(next);
      if (next) videoRef.current?.pause();
    },
    [videoRef],
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (!active) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = pointFromEvent(e);
      drawingStroke.current = { tool, color, points: [p, p] };
      redraw();
    },
    [active, tool, color, redraw],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLCanvasElement>) => {
      if (!active || !drawingStroke.current) return;
      const p = pointFromEvent(e);
      if (tool === "pen") drawingStroke.current.points.push(p);
      else drawingStroke.current.points[1] = p;
      redraw();
    },
    [active, tool, redraw],
  );

  const onPointerUp = useCallback(() => {
    const stroke = drawingStroke.current;
    if (!stroke) return;
    drawingStroke.current = null;
    const existing = strokesByFrame.current.get(frameIndex) ?? [];
    strokesByFrame.current.set(frameIndex, [...existing, stroke]);
    setVersion((v) => v + 1);
  }, [frameIndex]);

  const undo = useCallback(() => {
    const existing = strokesByFrame.current.get(frameIndex);
    if (!existing || existing.length === 0) return;
    strokesByFrame.current.set(frameIndex, existing.slice(0, -1));
    setVersion((v) => v + 1);
  }, [frameIndex]);

  const clearFrame = useCallback(() => {
    if (!strokesByFrame.current.has(frameIndex)) return;
    strokesByFrame.current.delete(frameIndex);
    setVersion((v) => v + 1);
  }, [frameIndex]);

  const hasStrokesOnFrame = (strokesByFrame.current.get(frameIndex)?.length ?? 0) > 0;

  return {
    canvasRef,
    active,
    setActive,
    tool,
    setTool,
    color,
    setColor,
    hasStrokesOnFrame,
    undo,
    clearFrame,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
