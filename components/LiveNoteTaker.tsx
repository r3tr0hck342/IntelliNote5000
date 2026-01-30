import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { MicIcon, StopIcon, PauseIcon, PlayIcon } from './icons';
import { LectureAsset, StudySession, TranscriptSegment } from '../types';
import type { StreamingSttConfig } from '../types/stt';
import { getRequiredSttConfig } from '../utils/transcriptionConfig';
import { createStreamingSttProvider, transcribeRecordedAudio } from '../services/stt';
import { buildTranscriptText, createId, finalizeSegment, mergeFinalSegments, upsertInterimSegment } from '../utils/transcript';
import { logEvent } from '../utils/logger';
import { pushToast } from '../utils/toastStore';
import { RingBuffer } from '../utils/ringBuffer';
import { mapSttError } from '../services/stt/errors';
import type { SttError } from '../services/stt/errors';

interface LiveNoteTakerProps {
    isSttReady: boolean;
    onOpenSettings: () => void;
    sessions: StudySession[];
    onCreateSession: (title: string, topic: string) => string;
    onCreateLiveAsset: (sessionId: string, sourceType: LectureAsset['sourceType'], language: string) => string;
    onTranscriptUpdate: (sessionId: string, assetId: string, segments: TranscriptSegment[], transcriptText: string, hasFinalUpdate: boolean, audioPath?: string) => void;
}

const AUDIO_BUFFER_CAPACITY = 40;
const AUDIO_FLUSH_INTERVAL_MS = 50;
const AUDIO_FRAMES_PER_FLUSH = 4;
const INTERIM_UPDATE_DEBOUNCE_MS = 1500;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
const RECONNECT_MAX_ATTEMPTS = 5;
const TARGET_SAMPLE_RATE = 16000;

const LiveNoteTaker: React.FC<LiveNoteTakerProps> = ({
    isSttReady,
    onOpenSettings,
    sessions,
    onCreateSession,
    onCreateLiveAsset,
    onTranscriptUpdate,
}) => {
    const [isRecording, setIsRecording] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedSessionId, setSelectedSessionId] = useState('new');
    const [newSessionTitle, setNewSessionTitle] = useState('');
    const [newSessionTopic, setNewSessionTopic] = useState('');
    const supportsLiveTranscription = Boolean(isSttReady);

    const [segments, setSegments] = useState<TranscriptSegment[]>([]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [audioLevel, setAudioLevel] = useState(0);
    const [isPostTranscribing, setIsPostTranscribing] = useState(false);
    const [postTranscribeError, setPostTranscribeError] = useState<string | null>(null);
    const [hasRecordedAudio, setHasRecordedAudio] = useState(false);
    
    type ConnectionStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'paused' | 'error' | 'closed';
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');

    const segmentsRef = useRef<TranscriptSegment[]>([]);
    const isPausedRef = useRef(isPaused);
    useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
    const connectionStatusRef = useRef(connectionStatus);
    useEffect(() => { connectionStatusRef.current = connectionStatus; }, [connectionStatus]);

    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const streamingSessionRef = useRef<ReturnType<ReturnType<typeof createStreamingSttProvider>['createSession']> | null>(null);
    const streamingProviderRef = useRef<ReturnType<typeof createStreamingSttProvider> | null>(null);
    const interimSegmentIdRef = useRef<string | null>(null);
    const timerRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const recordedAudioRef = useRef<Blob | null>(null);
    const recordedAudioMimeRef = useRef<string>('audio/webm');
    const activeSessionIdRef = useRef<string | null>(null);
    const activeAssetIdRef = useRef<string | null>(null);
    const startTimeRef = useRef<number>(0);
    const streamConfigRef = useRef<StreamingSttConfig | null>(null);
    const audioBufferRef = useRef(new RingBuffer<Int16Array>(AUDIO_BUFFER_CAPACITY));
    const audioFlushRef = useRef<number | null>(null);
    const droppedFramesRef = useRef(0);
    const interimFlushRef = useRef<number | null>(null);
    const reconnectAttemptRef = useRef(0);
    const reconnectTimerRef = useRef<number | null>(null);
    const autoPausedRef = useRef(false);

    const pushTranscriptUpdate = useCallback((segments: TranscriptSegment[], hasFinalUpdate: boolean, audioPath?: string) => {
        const sessionId = activeSessionIdRef.current;
        const assetId = activeAssetIdRef.current;
        if (!sessionId || !assetId) return;
        onTranscriptUpdate(sessionId, assetId, segments, buildTranscriptText(segments), hasFinalUpdate, audioPath);
    }, [onTranscriptUpdate]);

    const commitSegments = useCallback((nextSegments: TranscriptSegment[], hasFinalUpdate: boolean) => {
        segmentsRef.current = nextSegments;
        setSegments(nextSegments);
        pushTranscriptUpdate(nextSegments, hasFinalUpdate);
    }, [pushTranscriptUpdate]);

    const scheduleInterimFlush = useCallback(() => {
        if (interimFlushRef.current) return;
        interimFlushRef.current = window.setTimeout(() => {
            pushTranscriptUpdate(segmentsRef.current, false);
            interimFlushRef.current = null;
        }, INTERIM_UPDATE_DEBOUNCE_MS);
    }, [pushTranscriptUpdate]);

    const handleStreamingError = useCallback((err: SttError) => {
        console.error('Live session error:', err);
        const message = err.code === 'auth_failed'
            ? 'Transcription authentication failed. Check your API key.'
            : 'A streaming error occurred. Attempting to reconnect.';
        setError(message);
        pushToast({
            title: 'Transcription error',
            description: message,
            variant: 'error',
            action: err.retryable
                ? {
                    label: 'Retry',
                    onAction: () => startRecording(),
                }
                : undefined,
        });
        logEvent('error', 'STT error', { code: err.code, retryable: err.retryable });
        if (!err.retryable || err.code === 'auth_failed') {
            setConnectionStatus('error');
            streamingSessionRef.current?.stop();
            return;
        }
        setConnectionStatus('reconnecting');
    }, [startRecording]);

    const scheduleReconnect = useCallback(async () => {
        const streamConfig = streamConfigRef.current;
        const assetId = activeAssetIdRef.current;
        if (!streamConfig || !assetId || !isRecording) return;
        if (reconnectAttemptRef.current >= RECONNECT_MAX_ATTEMPTS) {
            setConnectionStatus('error');
            setError('Streaming connection lost. You can still transcribe after recording.');
            return;
        }
        const attempt = reconnectAttemptRef.current;
        reconnectAttemptRef.current += 1;
        const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt));
        setConnectionStatus('reconnecting');
        if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = window.setTimeout(async () => {
            try {
                const provider = streamingProviderRef.current;
                if (!provider) return;
                const session = provider.createSession(streamConfig, {
                    onInterim: (result) => {
                        const interimId = result.utteranceId
                            ? `segment-interim-${result.utteranceId}`
                            : interimSegmentIdRef.current ?? createId('segment-interim');
                        interimSegmentIdRef.current = interimId;
                        const createdAt = new Date().toISOString();
                        const segment: TranscriptSegment = {
                            id: interimId,
                            assetId,
                            startMs: result.startMs ?? 0,
                            endMs: result.endMs ?? 0,
                            text: result.text,
                            isFinal: false,
                            confidence: result.confidence,
                            speaker: result.words?.[0]?.speaker,
                            utteranceId: result.utteranceId,
                            createdAt,
                        };
                        const nextSegments = upsertInterimSegment(segmentsRef.current, segment);
                        commitSegments(nextSegments, false);
                        scheduleInterimFlush();
                    },
                    onFinal: (result) => {
                        const createdAt = new Date().toISOString();
                        const segment: TranscriptSegment = {
                            id: createId('segment-final'),
                            assetId,
                            startMs: result.startMs ?? 0,
                            endMs: result.endMs ?? 0,
                            text: result.text,
                            isFinal: true,
                            confidence: result.confidence,
                            speaker: result.words?.[0]?.speaker,
                            utteranceId: result.utteranceId,
                            createdAt,
                        };
                        const nextSegments = finalizeSegment(segmentsRef.current, segment, interimSegmentIdRef.current ?? undefined);
                        interimSegmentIdRef.current = null;
                        commitSegments(nextSegments, true);
                        logEvent('debug', 'Transcript segment finalized', { finalSegments: nextSegments.length });
                    },
                    onError: (err) => {
                        handleStreamingError(err);
                        if (err.retryable) {
                            scheduleReconnect();
                        }
                    },
                    onStateChange: (state) => {
                        if (state === 'connected') {
                            setConnectionStatus(isPausedRef.current ? 'paused' : 'live');
                        }
                        if (state === 'paused') {
                            setConnectionStatus('paused');
                        }
                        if (state === 'closed' && isRecording && !isPausedRef.current) {
                            scheduleReconnect();
                        }
                    },
                });
                streamingSessionRef.current = session;
                await session.connect();
            } catch (error) {
                handleStreamingError(mapSttError(error));
            }
        }, delay);
    }, [commitSegments, handleStreamingError, isRecording, scheduleInterimFlush]);

    const stopRecording = useCallback((isError = false) => {
        setIsRecording(false);
        setIsPaused(false);
        autoPausedRef.current = false;

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        scriptProcessorRef.current?.disconnect();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }

        streamingSessionRef.current?.stop();
        streamingSessionRef.current = null;
        streamingProviderRef.current = null;
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (audioFlushRef.current) {
            window.clearInterval(audioFlushRef.current);
            audioFlushRef.current = null;
        }
        if (interimFlushRef.current) {
            window.clearTimeout(interimFlushRef.current);
            interimFlushRef.current = null;
        }
        if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
        }
        reconnectAttemptRef.current = 0;
        audioBufferRef.current.clear();
        setElapsedSeconds(0);
        setAudioLevel(0);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        
        if (!isError) {
            const interimSegment = segmentsRef.current.find(segment => !segment.isFinal);
            if (interimSegment && activeAssetIdRef.current) {
                const createdAt = new Date().toISOString();
                const finalSegment: TranscriptSegment = {
                    ...interimSegment,
                    id: createId('segment-final'),
                    isFinal: true,
                    endMs: interimSegment.endMs || Math.max(0, Date.now() - startTimeRef.current),
                    createdAt,
                };
                const nextSegments = finalizeSegment(segmentsRef.current, finalSegment, interimSegmentIdRef.current ?? undefined);
                commitSegments(nextSegments, true);
                interimSegmentIdRef.current = null;
            }
            segmentsRef.current = [];
            setSegments([]);
        }

        if (connectionStatus !== 'error') {
             setConnectionStatus('idle');
        }
        logEvent('info', 'STT session stopped', { reason: isError ? 'error' : 'user' });
    }, [commitSegments, connectionStatus]);

    const startRecording = async () => {
        segmentsRef.current = [];
        setSegments([]);
        setError(null);
        setPostTranscribeError(null);
        interimSegmentIdRef.current = null;
        droppedFramesRef.current = 0;
        reconnectAttemptRef.current = 0;
        recordedAudioRef.current = null;
        setHasRecordedAudio(false);

        try {
            if (!supportsLiveTranscription) {
                setError("Live transcription requires a streaming STT provider. Configure one in Settings.");
                onOpenSettings();
                return;
            }
            if (!isSttReady) {
                setError("Please configure your transcription API key in settings to use live transcription.");
                onOpenSettings();
                return;
            }

            const sessionId = selectedSessionId === 'new'
                ? onCreateSession(newSessionTitle, newSessionTopic)
                : selectedSessionId;
            const assetId = onCreateLiveAsset(sessionId, 'live', 'en-US');
            activeSessionIdRef.current = sessionId;
            activeAssetIdRef.current = assetId;
            
            setIsRecording(true);
            setConnectionStatus('connecting');
            startTimeRef.current = Date.now();
            setElapsedSeconds(0);

            const sttConfig = getRequiredSttConfig();
            logEvent('info', 'Initializing STT provider', { provider: sttConfig.provider, language: sttConfig.language });
            const provider = createStreamingSttProvider(sttConfig);
            streamingProviderRef.current = provider;
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                },
            });

            const mimeTypeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
            const mimeType = mimeTypeCandidates.find(type => MediaRecorder.isTypeSupported(type));
            mediaRecorderRef.current = new MediaRecorder(mediaStreamRef.current, mimeType ? { mimeType } : undefined);
            audioChunksRef.current = [];
            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };
            mediaRecorderRef.current.onstop = () => {
                const blob = new Blob(audioChunksRef.current, { type: mimeType ?? 'audio/webm' });
                recordedAudioRef.current = blob;
                recordedAudioMimeRef.current = mimeType ?? 'audio/webm';
                setHasRecordedAudio(blob.size > 0);
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = typeof reader.result === 'string' ? reader.result : undefined;
                    if (base64) {
                        pushTranscriptUpdate(segmentsRef.current, false, base64);
                    }
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorderRef.current.start(1000);

            const streamConfig: StreamingSttConfig = {
                sampleRate: TARGET_SAMPLE_RATE,
                language: sttConfig.language ?? 'en-US',
                model: sttConfig.model ?? 'nova-2',
                enableInterimResults: true,
            };
            streamConfigRef.current = streamConfig;

            const session = provider.createSession(streamConfig, {
                onInterim: (result) => {
                    const interimId = result.utteranceId
                        ? `segment-interim-${result.utteranceId}`
                        : interimSegmentIdRef.current ?? createId('segment-interim');
                    interimSegmentIdRef.current = interimId;
                    const createdAt = new Date().toISOString();
                    const segment: TranscriptSegment = {
                        id: interimId,
                        assetId,
                        startMs: result.startMs ?? 0,
                        endMs: result.endMs ?? 0,
                        text: result.text,
                        isFinal: false,
                        confidence: result.confidence,
                        speaker: result.words?.[0]?.speaker,
                        utteranceId: result.utteranceId,
                        createdAt,
                    };
                    const nextSegments = upsertInterimSegment(segmentsRef.current, segment);
                    commitSegments(nextSegments, false);
                    scheduleInterimFlush();
                },
                onFinal: (result) => {
                    const createdAt = new Date().toISOString();
                    const segment: TranscriptSegment = {
                        id: createId('segment-final'),
                        assetId,
                        startMs: result.startMs ?? 0,
                        endMs: result.endMs ?? 0,
                        text: result.text,
                        isFinal: true,
                        confidence: result.confidence,
                        speaker: result.words?.[0]?.speaker,
                        utteranceId: result.utteranceId,
                        createdAt,
                    };
                    const nextSegments = finalizeSegment(segmentsRef.current, segment, interimSegmentIdRef.current ?? undefined);
                    interimSegmentIdRef.current = null;
                    commitSegments(nextSegments, true);
                    logEvent('debug', 'Transcript segment finalized', { finalSegments: nextSegments.length });
                },
                onError: (err) => {
                    handleStreamingError(err);
                    if (err.retryable) {
                        scheduleReconnect();
                    }
                },
                onStateChange: (state) => {
                    if (state === 'connecting') {
                        setConnectionStatus('connecting');
                    }
                    if (state === 'connected') {
                        reconnectAttemptRef.current = 0;
                        setConnectionStatus(isPausedRef.current ? 'paused' : 'live');
                        logEvent('info', 'STT connection established');
                    }
                    if (state === 'paused') {
                        setConnectionStatus('paused');
                    }
                    if (state === 'closed') {
                        if (connectionStatusRef.current !== 'error') {
                            setConnectionStatus('closed');
                        }
                        if (isRecording && !isPausedRef.current) {
                            scheduleReconnect();
                        }
                        logEvent('info', 'STT connection closed');
                    }
                },
            });

            streamingSessionRef.current = session;
            await session.connect();
            if (!mediaStreamRef.current) return;
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: TARGET_SAMPLE_RATE });
            if (audioContextRef.current.sampleRate !== TARGET_SAMPLE_RATE) {
                logEvent('warn', 'AudioContext sample rate mismatch', { actual: audioContextRef.current.sampleRate, expected: TARGET_SAMPLE_RATE });
            }
            const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                if (isPausedRef.current) return;
                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                const rms = Math.sqrt(inputData.reduce((sum, sample) => sum + sample * sample, 0) / inputData.length);
                setAudioLevel(rms);
                const int16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    int16[i] = inputData[i] < 0 ? inputData[i] * 32768 : inputData[i] * 32767;
                }
                const buffer = audioBufferRef.current;
                if (buffer.length >= AUDIO_BUFFER_CAPACITY) {
                    droppedFramesRef.current += 1;
                    if (droppedFramesRef.current % 10 === 0) {
                        logEvent('warn', 'Audio buffer backpressure', { droppedFrames: droppedFramesRef.current });
                    }
                    return;
                }
                buffer.push(int16);
            };

            audioFlushRef.current = window.setInterval(() => {
                if (isPausedRef.current) return;
                if (connectionStatusRef.current !== 'live') return;
                const session = streamingSessionRef.current;
                if (!session) return;
                const buffer = audioBufferRef.current;
                let sent = 0;
                while (sent < AUDIO_FRAMES_PER_FLUSH) {
                    const frame = buffer.shift();
                    if (!frame) break;
                    session.sendAudioFrame(frame);
                    sent += 1;
                }
            }, AUDIO_FLUSH_INTERVAL_MS);

            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(audioContextRef.current.destination);

            timerRef.current = window.setInterval(() => {
                setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
            }, 1000);

        } catch (err) {
            console.error("Failed to start recording:", err);
            const errorMessage = err instanceof Error && err.message.toLowerCase().includes("api key")
                ? "Please configure your transcription API key in settings to use live transcription."
                : "Could not access microphone. Please check permissions.";
            setError(errorMessage);
            pushToast({
                title: 'Microphone error',
                description: errorMessage,
                variant: 'error',
                action: {
                    label: 'Open Settings',
                    onAction: onOpenSettings,
                },
            });
            setIsRecording(false);
            setConnectionStatus('error');
        }
    };
    
    useEffect(() => {
        return () => {
            if(isRecording) {
                stopRecording();
            }
        };
    }, [isRecording, stopRecording]);

    useEffect(() => {
        const handleVisibility = () => {
            if (!isRecording) return;
            if (document.hidden) {
                if (!isPausedRef.current) {
                    autoPausedRef.current = true;
                    pauseRecording();
                }
            } else if (autoPausedRef.current) {
                autoPausedRef.current = false;
                resumeRecording();
            }
        };
        const handlePageHide = () => {
            if (isRecording) {
                stopRecording();
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('pagehide', handlePageHide);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pagehide', handlePageHide);
        };
    }, [isRecording, pauseRecording, resumeRecording, stopRecording]);

    const pauseRecording = () => {
        setIsPaused(true);
        streamingSessionRef.current?.pause();
        setConnectionStatus('paused');
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.pause();
        }
    };

    const resumeRecording = () => {
        setIsPaused(false);
        streamingSessionRef.current?.resume();
        if (connectionStatusRef.current !== 'live') {
            scheduleReconnect();
        }
        if (mediaRecorderRef.current?.state === 'paused') {
            mediaRecorderRef.current.resume();
        }
    };

    const transcribeAfterRecording = async () => {
        const assetId = activeAssetIdRef.current;
        const recordedAudio = recordedAudioRef.current;
        if (!recordedAudio || !assetId) return;
        setIsPostTranscribing(true);
        setPostTranscribeError(null);
        try {
            const sttConfig = getRequiredSttConfig();
            const result = await transcribeRecordedAudio(
                sttConfig,
                { blob: recordedAudio, mimeType: recordedAudioMimeRef.current },
                { language: sttConfig.language, model: sttConfig.model }
            );
            const createdAt = new Date().toISOString();
            const incomingSegments = result.segments.map(segment => ({
                id: createId('segment-final'),
                assetId,
                startMs: segment.startMs ?? 0,
                endMs: segment.endMs ?? 0,
                text: segment.text,
                isFinal: true,
                confidence: segment.confidence,
                speaker: segment.words?.[0]?.speaker,
                utteranceId: segment.utteranceId,
                createdAt,
            }));
            const merged = mergeFinalSegments(segmentsRef.current, incomingSegments);
            commitSegments(merged, true);
        } catch (err) {
            console.error('Failed to transcribe recorded audio:', err);
            setPostTranscribeError('Failed to transcribe recorded audio. Please try again.');
        } finally {
            setIsPostTranscribing(false);
        }
    };

    const renderConnectionStatus = () => {
        if (!isRecording && connectionStatus !== 'error') return null;

        let color = 'bg-gray-500';
        let text = 'Idle';
        let pulse = false;

        switch(connectionStatus) {
            case 'connecting':
                color = 'bg-yellow-500';
                text = 'Connecting...';
                break;
            case 'live':
                color = 'bg-green-500';
                text = 'Live';
                pulse = true;
                break;
            case 'reconnecting':
                color = 'bg-yellow-500';
                text = 'Reconnecting...';
                pulse = true;
                break;
            case 'paused':
                color = 'bg-blue-500';
                text = 'Paused';
                break;
            case 'error':
                color = 'bg-red-500';
                text = 'Connection Error';
                break;
            case 'closed':
                color = 'bg-gray-500';
                text = 'Connection Closed';
                break;
        }

        return (
             <div className="absolute top-4 right-4 flex items-center space-x-2 bg-gray-900 bg-opacity-70 px-3 py-1 rounded-full z-10">
                <span className={`h-3 w-3 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`}></span>
                <span className="text-sm text-gray-300">{text}</span>
            </div>
        )
    }
    
    const transcriptText = useMemo(() => {
        const finalText = segments.filter(s => s.isFinal).map(s => s.text).join(' ');
        return finalText;
    }, [segments]);

    const interimText = useMemo(() => {
        const interimSegment = segments.find(segment => !segment.isFinal);
        return interimSegment?.text ?? '';
    }, [segments]);

    return (
        <div className="relative flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 p-8 text-center">
            {renderConnectionStatus()}
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Live Note Taker</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-lg">
                Click the microphone to start recording your lecture. Your words will be transcribed in real-time with word-by-word updates.
            </p>

            <div className="mb-6 w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-left">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Save to Session</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                        value={selectedSessionId}
                        onChange={(e) => setSelectedSessionId(e.target.value)}
                        disabled={isRecording}
                        className="border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                    >
                        <option value="new">Create new session</option>
                        {sessions.map(session => (
                            <option key={session.id} value={session.id}>{session.title}</option>
                        ))}
                    </select>
                    {selectedSessionId === 'new' ? (
                        <input
                            type="text"
                            value={newSessionTitle}
                            onChange={(e) => setNewSessionTitle(e.target.value)}
                            placeholder="Session title"
                            disabled={isRecording}
                            className="border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                        />
                    ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
                            Recording will attach to the selected session.
                        </div>
                    )}
                </div>
                {selectedSessionId === 'new' && (
                    <input
                        type="text"
                        value={newSessionTopic}
                        onChange={(e) => setNewSessionTopic(e.target.value)}
                        placeholder="Session topic (optional)"
                        disabled={isRecording}
                        className="mt-3 w-full border border-gray-300 dark:border-gray-700 rounded-md p-2 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200"
                    />
                )}
            </div>
            
            <div className="mb-8 flex flex-col items-center space-y-3">
                <div className="flex items-center space-x-4">
                    {!isRecording ? (
                        <button
                            onClick={startRecording}
                            disabled={!supportsLiveTranscription || !isSttReady}
                            className="bg-indigo-600 text-white rounded-full p-6 hover:bg-indigo-700 transition-all duration-200 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <MicIcon className="w-12 h-12" />
                        </button>
                    ) : (
                        <>
                            <button onClick={() => stopRecording()} className="bg-red-600 text-white rounded-full p-6 hover:bg-red-700 transition-all duration-200 shadow-lg animate-pulse focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:ring-red-500">
                                <StopIcon className="w-12 h-12" />
                            </button>
                            {isPaused ? (
                                <button onClick={resumeRecording} className="bg-green-600 text-white rounded-full p-4 hover:bg-green-700 transition-all duration-200 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:ring-green-500">
                                    <PlayIcon className="w-8 h-8" />
                                </button>
                            ) : (
                                <button onClick={pauseRecording} className="bg-yellow-500 text-white rounded-full p-4 hover:bg-yellow-600 transition-all duration-200 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:ring-yellow-400">
                                    <PauseIcon className="w-8 h-8" />
                                </button>
                            )}
                        </>
                    )}
                </div>
                {!supportsLiveTranscription && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
                        Live transcription currently requires a streaming STT provider. Configure it under Settings to enable this feature.
                    </p>
                )}
            </div>

            {isRecording && (
                <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
                    <span className="font-semibold text-gray-700 dark:text-gray-200">Timer: {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}</span>
                    <div className="flex items-center space-x-2">
                        <span>Audio</span>
                        <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 transition-all duration-150" style={{ width: `${Math.min(100, audioLevel * 200)}%` }} />
                        </div>
                    </div>
                    {isPaused && <span className="text-yellow-500 font-semibold">Paused</span>}
                </div>
            )}

            <div className="w-full max-w-3xl h-64 bg-white dark:bg-gray-900 rounded-lg p-4 overflow-y-auto border border-gray-200 dark:border-gray-700">
                <p className="text-left text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
                    {transcriptText}
                    {transcriptText && interimText ? ' ' : ''}
                    <span className="text-gray-500 dark:text-gray-500 italic">{interimText}</span>
                    {!transcriptText && !interimText && <span className="text-gray-400 dark:text-gray-500">Waiting for audio...</span>}
                </p>
            </div>
            {!isRecording && hasRecordedAudio && (
                <div className="mt-4 flex flex-col items-center space-y-2">
                    <button
                        onClick={transcribeAfterRecording}
                        disabled={isPostTranscribing || !isSttReady}
                        className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPostTranscribing ? 'Transcribing...' : 'Transcribe After Recording'}
                    </button>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Use your configured transcription provider to process the saved audio.
                    </p>
                </div>
            )}
            {postTranscribeError && <p className="text-red-500 dark:text-red-400 mt-2">{postTranscribeError}</p>}
            {error && <p className="text-red-500 dark:text-red-400 mt-4">{error}</p>}
        </div>
    );
};

export default LiveNoteTaker;
