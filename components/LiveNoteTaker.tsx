import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MicIcon, StopIcon, PauseIcon, PlayIcon } from './icons';
import { LectureAsset, StudySession, TranscriptSegment } from '../types';
import { getRequiredSttConfig } from '../utils/transcriptionConfig';
import { createStreamingSttProvider } from '../services/stt';
import { buildTranscriptText, createId, finalizeSegment, upsertInterimSegment } from '../utils/transcript';

interface LiveNoteTakerProps {
    isSttReady: boolean;
    onOpenSettings: () => void;
    sessions: StudySession[];
    onCreateSession: (title: string, topic: string) => string;
    onCreateLiveAsset: (sessionId: string, sourceType: LectureAsset['sourceType'], language: string) => string;
    onTranscriptUpdate: (sessionId: string, assetId: string, segments: TranscriptSegment[], transcriptText: string, hasFinalUpdate: boolean, audioPath?: string) => void;
}

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

    // Store transcript as segments
    const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
    const [interimText, setInterimText] = useState('');
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [audioLevel, setAudioLevel] = useState(0);
    
    // State for connection status
    type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');

    // Refs to hold the latest state for callbacks that can't be re-created easily
    const transcriptRef = useRef(transcript);
    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
    const interimTextRef = useRef(interimText);
    useEffect(() => { interimTextRef.current = interimText; }, [interimText]);
    const isPausedRef = useRef(isPaused);
    useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const streamingSessionRef = useRef<Awaited<ReturnType<ReturnType<typeof createStreamingSttProvider>['start']>> | null>(null);
    const interimSegmentIdRef = useRef<string | null>(null);
    const timerRef = useRef<number | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const activeSessionIdRef = useRef<string | null>(null);
    const activeAssetIdRef = useRef<string | null>(null);
    
    const startTimeRef = useRef<number>(0);

    const pushTranscriptUpdate = useCallback((segments: TranscriptSegment[], hasFinalUpdate: boolean, audioPath?: string) => {
        const sessionId = activeSessionIdRef.current;
        const assetId = activeAssetIdRef.current;
        if (!sessionId || !assetId) return;
        onTranscriptUpdate(sessionId, assetId, segments, buildTranscriptText(segments), hasFinalUpdate, audioPath);
    }, [onTranscriptUpdate]);

    const stopRecording = useCallback((isError = false) => {
        setIsRecording(false);
        setIsPaused(false);

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        scriptProcessorRef.current?.disconnect();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }

        streamingSessionRef.current?.stop();
        streamingSessionRef.current = null;
        if (timerRef.current) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setElapsedSeconds(0);
        setAudioLevel(0);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        
        if (!isError) {
            if (interimTextRef.current.trim() && activeAssetIdRef.current) {
                const createdAt = new Date().toISOString();
                const finalSegment: TranscriptSegment = {
                    id: createId('segment-final'),
                    assetId: activeAssetIdRef.current,
                    startMs: 0,
                    endMs: Math.max(0, Date.now() - startTimeRef.current),
                    text: interimTextRef.current,
                    isFinal: true,
                    createdAt,
                };
                const updated = finalizeSegment(transcriptRef.current, finalSegment, interimSegmentIdRef.current ?? undefined);
                pushTranscriptUpdate(updated, true);
                interimSegmentIdRef.current = null;
            }
            setTranscript([]);
            setInterimText('');
        }

        if (connectionStatus !== 'error') {
             setConnectionStatus('idle');
        }
    }, [connectionStatus, pushTranscriptUpdate]);

    const startRecording = async () => {
        setTranscript([]);
        setInterimText('');
        setError(null);
        interimSegmentIdRef.current = null;

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
            const provider = createStreamingSttProvider(sttConfig);
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
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = typeof reader.result === 'string' ? reader.result : undefined;
                    if (base64) {
                        pushTranscriptUpdate(transcriptRef.current, false, base64);
                    }
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorderRef.current.start(1000);

            streamingSessionRef.current = await provider.start(
                {
                    sampleRate: 16000,
                    language: sttConfig.language ?? 'en-US',
                    model: sttConfig.model ?? 'nova-2',
                    enableInterimResults: true,
                },
                {
                    onInterim: (result) => {
                        const interimId = interimSegmentIdRef.current ?? createId('segment-interim');
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
                            createdAt,
                        };
                        setTranscript(prev => {
                            const updated = upsertInterimSegment(prev, segment);
                            pushTranscriptUpdate(updated, false);
                            return updated;
                        });
                        setInterimText(result.text);
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
                            createdAt,
                        };
                        setTranscript(prev => {
                            const updated = finalizeSegment(prev, segment, interimSegmentIdRef.current ?? undefined);
                            interimSegmentIdRef.current = null;
                            pushTranscriptUpdate(updated, true);
                            return updated;
                        });
                        setInterimText('');
                    },
                    onError: (error) => {
                        console.error('Live session error:', error);
                        setError('A connection error occurred.');
                        setConnectionStatus('error');
                        stopRecording(true);
                    },
                    onClose: () => {
                        if (connectionStatus !== 'error') {
                            setConnectionStatus('closed');
                        }
                    },
                }
            );
            
            setConnectionStatus('connected');
            if (!mediaStreamRef.current) return;
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
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
                streamingSessionRef.current?.sendAudioFrame(int16);
            };

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

    const pauseRecording = () => {
        setIsPaused(true);
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.pause();
        }
    };

    const resumeRecording = () => {
        setIsPaused(false);
        if (mediaRecorderRef.current?.state === 'paused') {
            mediaRecorderRef.current.resume();
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
            case 'connected':
                color = 'bg-green-500';
                text = 'Connected & Listening';
                pulse = true;
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
    
    const transcriptText = transcript.filter(segment => segment.isFinal).map(s => s.text).join(' ');

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
            {error && <p className="text-red-500 dark:text-red-400 mt-4">{error}</p>}
        </div>
    );
};

export default LiveNoteTaker;
