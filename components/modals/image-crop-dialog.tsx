"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut, RotateCcw, Loader2 } from "lucide-react";

interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onCrop: (croppedDataUrl: string) => void;
  saving?: boolean;
}

export function ImageCropDialog({
  open,
  imageSrc,
  onClose,
  onCrop,
  saving,
}: ImageCropDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Load image when src changes
  useEffect(() => {
    if (!imageSrc) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets crop state when imageSrc changes, gated by that dependency, before loading the new external Image resource below
    setImageLoaded(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Draw the preview
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);

    // Fill with dark background
    ctx.fillStyle = "hsl(0 0% 5%)";
    ctx.fillRect(0, 0, size, size);

    // Calculate scaled dimensions to fit image
    const scale = zoom * Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (size - w) / 2 + offset.x;
    const y = (size - h) / 2 + offset.y;

    ctx.drawImage(img, x, y, w, h);

    // Draw circular mask overlay
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }, [zoom, offset]);

  useEffect(() => {
    if (imageLoaded) draw();
  }, [imageLoaded, draw]);

  // How far the image can be dragged in either direction before its edge
  // would pull inside the crop circle and leave a gap -- half of however
  // much bigger than the canvas the scaled image currently is. Zero once
  // an axis is exactly "cover" sized (the tighter axis at zoom 1).
  const getMaxOffset = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return { x: 0, y: 0 };
    const size = canvas.width;
    const scale = zoom * Math.max(size / img.width, size / img.height);
    return {
      x: Math.max(0, (img.width * scale - size) / 2),
      y: Math.max(0, (img.height * scale - size) / 2),
    };
  }, [zoom]);

  // Re-clamp whenever zoom changes: an offset that was in-bounds at a
  // higher zoom can leave a gap once the image shrinks back down.
  useEffect(() => {
    if (!imageLoaded) return;
    const max = getMaxOffset();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-clamps offset when zoom changes (via getMaxOffset), gated by imageLoaded/that dependency, not run on every render
    setOffset((prev) => ({
      x: Math.min(max.x, Math.max(-max.x, prev.x)),
      y: Math.min(max.y, Math.max(-max.y, prev.y)),
    }));
  }, [zoom, imageLoaded, getMaxOffset]);

  // Mouse / touch drag handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY };
      offsetStart.current = { ...offset };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [offset],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const max = getMaxOffset();
      setOffset({
        x: Math.min(max.x, Math.max(-max.x, offsetStart.current.x + dx)),
        y: Math.min(max.y, Math.max(-max.y, offsetStart.current.y + dy)),
      });
    },
    [dragging, getMaxOffset],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleReset = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const handleCropAndSave = () => {
    // Render final crop at 256x256
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = 256;
    outputCanvas.height = 256;
    const ctx = outputCanvas.getContext("2d");
    const img = imageRef.current;
    if (!ctx || !img) return;

    const size = 256;
    const scale = zoom * Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    // Scale offset from preview canvas (300px) to output (256px)
    const previewSize = canvasRef.current?.width || 300;
    const ratio = size / previewSize;
    const x = (size - w) / 2 + offset.x * ratio;
    const y = (size - h) / 2 + offset.y * ratio;

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x, y, w, h);

    const dataUrl = outputCanvas.toDataURL("image/png", 0.9);
    onCrop(dataUrl);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Profile Picture</DialogTitle>
          <DialogDescription>
            Drag to reposition and use the slider to zoom. Your picture will be
            cropped to a circle.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          {/* Canvas preview */}
          <div
            ref={containerRef}
            role="img"
            aria-label="Photo preview. Drag to reposition, use the zoom slider below to resize."
            className="relative w-[280px] h-[280px] sm:w-[300px] sm:h-[300px] rounded-full overflow-hidden border-2 border-border bg-secondary/20 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <canvas
              ref={canvasRef}
              width={300}
              height={300}
              className="w-full h-full"
              aria-hidden="true"
            />
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2
                  className="h-6 w-6 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            )}
          </div>

          {/* Zoom control */}
          <div className="flex items-center gap-3 w-full max-w-[300px]">
            <ZoomOut
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            <Slider
              value={[zoom]}
              min={1}
              max={3}
              step={0.05}
              onValueChange={([v]) => setZoom(v)}
              className="flex-1"
              aria-label="Zoom"
            />
            <ZoomIn
              className="h-4 w-4 text-muted-foreground shrink-0"
              aria-hidden="true"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleReset}
              aria-label="Reset zoom and position"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            className="bg-transparent"
          >
            Cancel
          </Button>
          <Button onClick={handleCropAndSave} disabled={!imageLoaded || saving}>
            {saving ? (
              <>
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
