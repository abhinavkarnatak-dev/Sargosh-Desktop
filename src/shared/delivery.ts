export const MAX_DELIVERY_CHARS = 24_000;
export interface DeliveryRequest { sessionId: string; targetId: string; text: string }
export interface DeliveryResult { status: 'sent' | 'unavailable' | 'unconfirmed'; message: string }
export interface DeliveryState { phase: 'idle' | 'working' | 'completed' | 'failed' | 'cancelled'; sessionId: string | null; message: string }
export const INITIAL_DELIVERY: DeliveryState = { phase: 'idle', sessionId: null, message: '' };
export function validDeliveryRequest(value: unknown): value is DeliveryRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as DeliveryRequest;
  return typeof request.sessionId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(request.sessionId) &&
    typeof request.targetId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(request.targetId) &&
    typeof request.text === 'string' && !!request.text.trim() && request.text.length <= MAX_DELIVERY_CHARS &&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(request.text);
}
export const deliveryTimeout = (text: string) => 10_000 + text.length * 40;
