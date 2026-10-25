import { useEffect, useRef, useState } from 'preact/hooks';
import { IconButton } from '../ui/IconButton';

export function AudioLevel({ stream }: { stream: MediaStream | null }) {
  const context = useRef<AudioContext | null>(null);
  const [state, setState] = useState<'waiting' | 'running' | 'paused' | 'unavailable'>('waiting');
  const [level, setLevel] = useState(0);
  useEffect(() => {
    setLevel(0);
    setState('waiting');
    if (!stream) return;
    let audio: AudioContext;
    try {
      audio = new AudioContext();
    } catch {
      setState('unavailable');
      return;
    }
    context.current = audio;
    const analyser = audio.createAnalyser();
    analyser.fftSize = 1024;
    let source: MediaStreamAudioSourceNode | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const samples = new Float32Array(analyser.fftSize);
    function attach() {
      if (source || !stream!.getAudioTracks().length) return;
      source = audio.createMediaStreamSource(stream!);
      source.connect(analyser); // No destination connection: video owns audible playback.
    }
    function measure() {
      attach();
      if (!source || audio.state !== 'running') {
        setLevel(0);
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
      );
      const db = 20 * Math.log10(Math.max(rms, 0.00001));
      setLevel(Math.round(Math.max(0, Math.min(100, ((db + 60) / 60) * 100))));
    }
    function changed() {
      setState(audio.state === 'running' ? 'running' : 'paused');
    }
    function visibility() {
      clearInterval(timer);
      if (document.visibilityState === 'visible') {
        measure();
        timer = setInterval(measure, 100);
      }
    }
    audio.addEventListener('statechange', changed);
    stream.addEventListener('addtrack', attach);
    document.addEventListener('visibilitychange', visibility);
    changed();
    visibility();
    return () => {
      clearInterval(timer);
      audio.removeEventListener('statechange', changed);
      stream.removeEventListener('addtrack', attach);
      document.removeEventListener('visibilitychange', visibility);
      source?.disconnect();
      analyser.disconnect();
      context.current = null;
      void audio.close().catch(() => {});
    };
  }, [stream]);
  async function resume() {
    try {
      await context.current?.resume();
    } catch {
      setState('unavailable');
    }
  }
  if (!stream) return null;
  if (state === 'paused')
    return <IconButton icon="sound-off" label="Enable sound meter" onClick={resume} />;
  return (
    <div
      class="audio-level"
      role="meter"
      aria-label="Live sound level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={level}
      aria-valuetext={state === 'running' ? `${level}%` : 'Unavailable'}
      data-tooltip={state === 'running' ? 'Sound level' : 'Sound meter unavailable'}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        {[7, 12, 17, 22].map((height, i) => (
          <rect
            key={i}
            x={2 + i * 6}
            y={(24 - height) / 2}
            width="3"
            height={height}
            rx="1.5"
            fill="currentColor"
            opacity={state === 'running' && level > i * 25 + 3 ? 1 : 0.25}
          />
        ))}
        {state === 'unavailable' && <path d="m2 2 20 20" stroke="currentColor" stroke-width="2" />}
      </svg>
    </div>
  );
}
