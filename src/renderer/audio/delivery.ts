import { INITIAL_DELIVERY, type DeliveryRequest, type DeliveryResult, type DeliveryState } from '../../shared/delivery';
export class DeliveryController {
  private state = { ...INITIAL_DELIVERY };
  private listeners = new Set<() => void>();
  private attempted = new Set<string>();
  private active?: AbortController;
  constructor(private send: (request: DeliveryRequest, signal: AbortSignal) => Promise<DeliveryResult>) {}
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: DeliveryState) { this.state = value; for (const listener of this.listeners) listener(); }
  async start(request: DeliveryRequest) {
    if (this.active || this.attempted.has(request.sessionId)) return;
    this.attempted.add(request.sessionId);
    const abort = new AbortController(); this.active = abort;
    this.update({ phase: 'working', sessionId: request.sessionId, message: 'Preparing text...' });
    try {
      const result = await this.send(request, abort.signal);
      if (this.active !== abort) return;
      this.active = undefined;
      this.update({ phase: result.status === 'sent' ? 'completed' : 'failed', sessionId: request.sessionId, message: result.message });
    } catch {
      if (this.active !== abort) return;
      this.active = undefined;
      this.update({ phase: 'failed', sessionId: request.sessionId, message: 'Insertion could not be confirmed. Check your textbox before trying again. Your transcript is still available.' });
    }
  }
  unavailable(sessionId: string) {
    if (this.state.sessionId !== sessionId) this.update({ phase: 'failed', sessionId, message: 'No saved textbox is available. Select a writable input before recording. Your transcript is still available.' });
  }
  cancel() {
    if (!this.active) return;
    const active = this.active; this.active = undefined; active.abort();
    this.update({ phase: 'cancelled', sessionId: this.state.sessionId, message: 'Insertion stopped. Some text may already be in your textbox. Check it before continuing.' });
  }
  clear() { this.cancel(); this.update({ ...INITIAL_DELIVERY }); }
}
export async function deliveryTransport(request: DeliveryRequest, signal: AbortSignal): Promise<DeliveryResult> {
  const bridge = window.sargosh;
  if (!bridge) throw new Error('Text insertion requires the desktop app.');
  const cancel = () => { void bridge.cancelDelivery(request.sessionId).catch(() => {}); };
  if (signal.aborted) throw new Error('Insertion cancelled.');
  signal.addEventListener('abort', cancel, { once: true });
  try { return await bridge.deliverText(request); }
  finally { signal.removeEventListener('abort', cancel); }
}
