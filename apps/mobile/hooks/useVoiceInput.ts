import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAudioRecorder,
  RecordingPresets,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { uploadAsync, FileSystemUploadType } from 'expo-file-system/legacy';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { API_BASE, getAuthHeader } from '@/lib/api';

type VoiceState = 'idle' | 'recording' | 'transcribing';

// Metering on so the orb can react to the live mic level.
const REC_OPTS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/**
 * Voice input — record mic audio with expo-audio, then transcribe via the same
 * /api/transcribe (Groq Whisper) endpoint the web app uses. Returns a toggle:
 * first press starts recording, second stops + transcribes and calls onResult.
 *
 * Also exposes `level` — a 0..1 reanimated SharedValue tracking the live mic
 * amplitude (smoothed from getStatus().metering dBFS) so the VoiceOrb can
 * breathe with the user's voice — and `cancel` to abort without transcribing.
 *
 * The upload uses expo-file-system's native multipart uploadAsync rather than
 * fetch + FormData: the app's global fetch is Expo's WinterCG implementation
 * (required for the streaming chat response), which rejects React Native's
 * `{ uri, name, type }` file-part shortcut ("unsupported FormData part").
 * uploadAsync streams the file natively and sidesteps that entirely.
 *
 * Requires the expo-audio native module (a dev rebuild — `npx expo run:ios`).
 */
export function useVoiceInput(onResult: (text: string) => void): {
  state: VoiceState;
  error: string;
  toggle: () => void;
  cancel: () => void;
  level: SharedValue<number>;
} {
  const recorder = useAudioRecorder(REC_OPTS);
  const [state, setState] = useState<VoiceState>('idle');
  const [error, setError] = useState('');
  const level = useSharedValue(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    level.value = withTiming(0, { duration: 250 });
  }, [level]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const start = useCallback(async () => {
    setError('');
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setError('Microphone access denied.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState('recording');
    pollRef.current = setInterval(() => {
      const m = recorder.getStatus().metering;
      // metering is dBFS (~-60 silence .. 0 max). Map to 0..1, then ease toward it.
      const target = typeof m === 'number' && isFinite(m) ? Math.max(0, Math.min(1, (m + 55) / 55)) : 0;
      level.value = level.value + (target - level.value) * 0.35;
    }, 70);
  }, [recorder, level]);

  const stop = useCallback(async () => {
    stopPolling();
    setState('transcribing');
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) { setError('No recording captured. Try again.'); setState('idle'); return; }

      const headers = await getAuthHeader();
      const res = await uploadAsync(`${API_BASE}/api/transcribe`, uri, {
        httpMethod: 'POST',
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: 'audio',
        mimeType: 'audio/m4a',
        headers,
      });

      if (res.status < 200 || res.status >= 300) {
        // Show the server's own words when it sent some ("Daily voice limit
        // reached"); a limit used to read as a broken recording.
        let serverMsg = '';
        try { serverMsg = String((JSON.parse(res.body) as { error?: string }).error ?? ''); } catch {}
        setError(serverMsg && !/^[a-z0-9_]+$/.test(serverMsg) ? serverMsg : 'Could not transcribe that. Try again.');
        return;
      }
      const data = JSON.parse(res.body) as { text?: string; error?: string };
      if (data.text?.trim()) onResult(data.text.trim());
      else setError('Could not transcribe that. Try again.');
    } catch {
      setError('Transcription failed. Try again.');
    } finally {
      setState('idle');
    }
  }, [recorder, onResult, stopPolling]);

  const cancel = useCallback(async () => {
    stopPolling();
    try { await recorder.stop(); } catch { /* nothing was recorded */ }
    setState('idle');
  }, [recorder, stopPolling]);

  const toggle = useCallback(() => {
    if (state === 'transcribing') return;
    if (state === 'recording') void stop();
    else void start();
  }, [state, start, stop]);

  return { state, error, toggle, cancel, level };
}
