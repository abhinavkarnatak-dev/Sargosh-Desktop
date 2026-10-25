export function resizeOverlayBounds(bounds: { x: number; y: number; width: number; height: number }, area: { x: number; y: number; width: number; height: number }, height: number) {
  const width = Math.min(420, area.width);
  height = Math.max(120, Math.min(Math.round(height), 400, area.height));
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x + (bounds.width - width) / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y + bounds.height - height, area.y + area.height - height))), width, height };
}
