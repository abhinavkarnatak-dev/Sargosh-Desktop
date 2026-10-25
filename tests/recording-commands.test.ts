import { afterEach, expect, it, vi } from 'vitest';
import { RecordingCommands, type RecordingCommand } from '../src/main/recording-commands';
afterEach(() => vi.useRealTimers());
it('waits for the microphone owner to acknowledge an action', async () => {
  const commands = new RecordingCommands(); let command!: RecordingCommand;
  const done = vi.fn();
  const request = commands.run(10, 'finish', value => { command = value; }).then(done);
  await Promise.resolve(); expect(done).not.toHaveBeenCalled();
  commands.settle(11, command.id, true); await Promise.resolve(); expect(done).not.toHaveBeenCalled();
  commands.settle(10, command.id, true); await request; expect(done).toHaveBeenCalledOnce();
});
it('reports a missing listener rather than silently succeeding', async () => {
  vi.useFakeTimers(); const commands = new RecordingCommands();
  const request = expect(commands.run(10, 'cancel', () => {})).rejects.toThrow('Restart Sargosh');
  await vi.advanceTimersByTimeAsync(6500); await request;
});
it('rejects outstanding requests when the owner reloads or closes', async () => {
  const commands = new RecordingCommands();
  const request = expect(commands.run(10, 'cancel', () => {})).rejects.toThrow('Restart Sargosh');
  commands.cancelAll(); await request;
});
it('reports transport and owner execution failures', async () => {
  const commands = new RecordingCommands();
  await expect(commands.run(10, 'finish', () => { throw new Error(); })).rejects.toThrow('Restart Sargosh');
  await expect(commands.run(10, 'cancel', value => commands.settle(10, value.id, false))).rejects.toThrow('Restart Sargosh');
});
