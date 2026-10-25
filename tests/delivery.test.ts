import { expect, it, vi } from 'vitest';
import { DeliveryController } from '../src/renderer/audio/delivery';
import { deliveryTimeout, validDeliveryRequest } from '../src/shared/delivery';
const request = { sessionId: 'session-1', targetId: 'target-1', text: 'Hello, नमस्ते 👋' };
it('validates payloads and allows ordinary Unicode and line breaks', () => {
  expect(validDeliveryRequest(request)).toBe(true);
  expect(validDeliveryRequest({ ...request, text: 'First\nSecond\tthird' })).toBe(true);
  for (const patch of [{ text: '' }, { text: ' '.repeat(10) }, { text: 'a'.repeat(24001) }, { text: '\u0000' }, { text: '\u001b[2J' }, { sessionId: '../file' }, { targetId: null }]) {
    expect(validDeliveryRequest({ ...request, ...patch })).toBe(false);
  }
  expect(deliveryTimeout('a'.repeat(1000))).toBeGreaterThan(15_000);
});
it('claims attempts before dispatch and does not repeat success or uncertain failure', async () => {
  for (const status of ['sent', 'unconfirmed'] as const) {
    const send = vi.fn(async () => ({ status, message: 'Check input.' })); const delivery = new DeliveryController(send);
    await Promise.all([delivery.start(request), delivery.start(request)]); await delivery.start(request);
    expect(send).toHaveBeenCalledOnce();
  }
});
it('retains the attempt after cancellation and ignores late completion', async () => {
  let finish!: (result: { status: 'sent'; message: string }) => void;
  const send = vi.fn((_request, _signal) => new Promise<{ status: 'sent'; message: string }>(resolve => { finish = resolve; }));
  const delivery = new DeliveryController(send); const pending = delivery.start(request);
  delivery.cancel(); expect(send.mock.calls[0][1].aborted).toBe(true);
  finish({ status: 'sent', message: 'Late' }); await pending; expect(delivery.getState().phase).toBe('cancelled');
  await delivery.start(request); expect(send).toHaveBeenCalledOnce();
});
it('allows a new session while a cancelled old promise settles', async () => {
  let finish!: (result: { status: 'sent'; message: string }) => void;
  const send = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ status: 'sent', message: 'New session sent.' });
  const delivery = new DeliveryController(send); const old = delivery.start(request); delivery.clear();
  await delivery.start({ ...request, sessionId: 'session-2' }); finish({ status: 'sent', message: 'Late' }); await old;
  expect(delivery.getState()).toMatchObject({ sessionId: 'session-2', phase: 'completed', message: 'New session sent.' });
});
it('reports a transport failure and never automatically retries', async () => {
  const send = vi.fn().mockRejectedValue(new Error('Timeout')); const delivery = new DeliveryController(send);
  await delivery.start(request); expect(delivery.getState().message).toContain('could not be confirmed');
  await delivery.start(request); expect(send).toHaveBeenCalledOnce();
});
