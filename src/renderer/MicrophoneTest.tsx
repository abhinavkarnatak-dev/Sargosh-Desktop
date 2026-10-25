import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
export function MicrophoneTest({ microphoneId, onDevices, disabled = false }: { microphoneId: string; onDevices(devices: MediaDeviceInfo[]): void; disabled?: boolean }) {
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resources = useRef<{ stream?: MediaStream; context?: AudioContext; animation?: number }>({});
  const alive = useRef(true);
  const starting = useRef(false);
  const generation = useRef(0);
  function release() {
    const current = resources.current;
    if (current.animation) cancelAnimationFrame(current.animation);
    current.stream?.getTracks().forEach(track => track.stop());
    void current.context?.close().catch(() => {});
    resources.current = {};
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; release(); }; }, []);
  useEffect(() => { generation.current++; release(); setTesting(false); setLevel(0); }, [microphoneId]);
  useEffect(() => { if (disabled) { generation.current++; release(); setTesting(false); setLevel(0); } }, [disabled]);
  async function start() {
    if (disabled) return;
    if (starting.current) return;
    starting.current = true; setBusy(true); setError('');
    const requestGeneration = generation.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneId === 'default' ? true : { deviceId: { exact: microphoneId } }, video: false });
      if (!alive.current || requestGeneration !== generation.current) { stream.getTracks().forEach(track => track.stop()); return; }
      resources.current.stream = stream;
      const context = new AudioContext(); resources.current.context = context;
      const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser();
      analyser.fftSize = 256; source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const update = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        setLevel(Math.min(100, Math.round(rms * 400)));
        resources.current.animation = requestAnimationFrame(update);
      };
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (alive.current) { release(); setTesting(false); setError('The microphone disconnected. Select an available input and try again.'); } }, { once: true });
      onDevices((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput'));
      if (!alive.current || requestGeneration !== generation.current) { release(); return; }
      setTesting(true); update();
    } catch {
      release();
      if (alive.current) setError('Could not open the microphone. Check Windows microphone access and your selected device.');
    } finally { starting.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="microphone-test"><div className="mic-test-header"><div><strong>Check your microphone</strong><p>This test stays on your computer. Nothing is recorded or uploaded.</p></div><button className="button secondary" disabled={busy || disabled} onClick={() => testing ? (release(), setTesting(false), setLevel(0)) : void start()}>{testing ? <Square size={14} /> : <Mic size={15} />}{busy ? 'Opening...' : testing ? 'Stop test' : 'Test microphone'}</button></div><div className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}><span style={{ width: level + '%' }} /></div><span className="meter-caption">{testing ? 'Speak naturally. The bar follows your microphone level.' : 'The microphone is off.'}</span>{error && <p className="error-message" role="alert">{error}</p>}</div>;
}
