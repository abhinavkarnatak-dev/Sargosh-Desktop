export type OverlayDock = 'left' | 'right' | 'bottom';
export interface DockPoint { x: number; y: number }
export interface DockBounds extends DockPoint { width: number; height: number }
export interface DockPreference { position: OverlayDock; displayId: number }
export interface DockState { position: OverlayDock; dragging: boolean; target: OverlayDock | null }
export const DEFAULT_DOCK: DockState = { position: 'bottom', dragging: false, target: null };
export function validDockPreference(value: unknown): value is DockPreference {
  if (!value || typeof value !== 'object') return false;
  const entry = value as DockPreference;
  return ['left', 'right', 'bottom'].includes(entry.position) && Number.isInteger(entry.displayId);
}
export function dockAnchor(position: OverlayDock, area: DockBounds): DockPoint {
  return position === 'left' ? { x: area.x + 33, y: area.y + area.height / 2 }
    : position === 'right' ? { x: area.x + area.width - 33, y: area.y + area.height / 2 }
    : { x: area.x + area.width / 2, y: area.y + area.height - 39 };
}
export function nearestDock(point: DockPoint, area: DockBounds): OverlayDock {
  return (['bottom', 'left', 'right'] as OverlayDock[]).reduce((best, next) => {
    const a = dockAnchor(best, area), b = dockAnchor(next, area);
    return Math.hypot(point.x - b.x, point.y - b.y) < Math.hypot(point.x - a.x, point.y - a.y) ? next : best;
  });
}
export function dockBounds(position: OverlayDock, area: DockBounds, requestedHeight: number): DockBounds {
  const width = Math.min(position === 'bottom' ? 420 : 500, Math.max(44, area.width - 16));
  const height = Math.min(Math.max(44, area.height - 16), position === 'bottom' ? Math.max(120, Math.min(400, requestedHeight)) : Math.max(180, Math.min(400, requestedHeight - 56)));
  return { x: Math.round(position === 'left' ? area.x + 8 : position === 'right' ? area.x + area.width - width - 8 : area.x + (area.width - width) / 2),
    y: Math.round(position === 'bottom' ? area.y + area.height - height - 8 : area.y + (area.height - height) / 2), width, height };
}
export function localDockAnchor(position: OverlayDock, bounds: DockBounds): DockPoint {
  return { x: position === 'left' ? 25 : position === 'right' ? bounds.width - 25 : bounds.width / 2,
    y: position === 'bottom' ? bounds.height - 31 : bounds.height / 2 };
}
