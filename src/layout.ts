export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

export interface Layout {
  /** Where the canvas sits, in CSS pixels relative to the video's offset parent. */
  rect: Rect;
  /** The canvas backing store, in device pixels. This is the upscale target. */
  target: Size;
}

/** Where the picture lands inside the video's content box for the given `object-fit`. */
export function fitRect(box: Rect, video: Size, objectFit: string): Rect {
  if (video.width <= 0 || video.height <= 0 || box.width <= 0 || box.height <= 0) return box;
  if (objectFit === 'fill') return box;
  const scaleX = box.width / video.width;
  const scaleY = box.height / video.height;
  let scale = objectFit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  if (objectFit === 'none') scale = 1;
  if (objectFit === 'scale-down') scale = Math.min(1, Math.min(scaleX, scaleY));
  const width = video.width * scale;
  const height = video.height * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

/** The canvas rectangle and the device-pixel upscale target, capped at `maxPixels`. */
export function computeLayout(
  box: Rect,
  video: Size,
  objectFit: string,
  devicePixelRatio: number,
  maxPixels: number,
): Layout {
  const rect = fitRect(box, video, objectFit);
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  let width = rect.width * dpr;
  let height = rect.height * dpr;
  const pixels = width * height;
  if (pixels > maxPixels) {
    const shrink = Math.sqrt(maxPixels / pixels);
    width *= shrink;
    height *= shrink;
  }
  return {
    rect,
    target: { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) },
  };
}

/** Whether a new target differs enough from the current one to rebuild the pipeline for it. */
export function targetChanged(previous: Size | null, next: Size, tolerance = 0.05): boolean {
  if (!previous) return true;
  const dw = Math.abs(previous.width - next.width) / Math.max(1, previous.width);
  const dh = Math.abs(previous.height - next.height) / Math.max(1, previous.height);
  return dw > tolerance || dh > tolerance;
}
