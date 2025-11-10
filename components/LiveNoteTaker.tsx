import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { MicIcon, StopIcon, BrainIcon } from './icons';
import { TranscriptSegment } from '../types';

interface LiveNoteTakerProps {
    onTranscriptionComplete: (transcript: TranscriptSegment[]) => void;
    isApiKeyReady: boolean;
    onOpenSettings: () => void;
}

const getAi = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API_KEY environment variable not set. It should be configured in the execution environment.");
    return new GoogleGenAI({ apiKey });
};

// Encoding/decoding functions for audio must be implemented manually as per guidelines.
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] < 0 ? data[i] * 32768 : data[i] * 32767;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}


const LiveNoteTaker: React.FC<LiveNoteTakerProps> = ({ onTranscriptionComplete, isApiKeyReady, onOpenSettings }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Store transcript as segments
    const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
    const [interimText, setInterimText] = useState('');
    
    // State for connection status
    type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';
    const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');

    // Refs to hold the latest state for callbacks that can't be re-created easily
    const transcriptRef = useRef(transcript);
    useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
    const interimTextRef = useRef(interimText);
    useEffect(() => { interimTextRef.current = interimText; }, [interimText]);

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    
    const startTimeRef = useRef<number>(0);

    const handleMessage = (message: LiveServerMessage) => {
        if (message.serverContent?.inputTranscription) {
            const { text } = message.serverContent.inputTranscription;
            setInterimText(prev => prev + text);
        }
        if (message.serverContent?.turnComplete) {
            const turnEndTime = Date.now();
            const duration = (turnEndTime - startTimeRef.current) / 1000;
            // Use functional update to get the latest interimText and avoid stale closures
            setInterimText(currentInterimText => {
                if (currentInterimText.trim()) {
                    setTranscript(prevTranscript => [...prevTranscript, { text: currentInterimText, startTime: duration }]);
                }
                return ''; // Reset interim text
            });
        }
    };

    const stopRecording = useCallback((isError = false) => {
        setIsRecording(false);

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        scriptProcessorRef.current?.disconnect();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
        }

        sessionPromiseRef.current?.then(session => {
            session.close();
            sessionPromiseRef.current = null;
        });

        if (!isError) {
            // Use refs to get the latest state for the final callback
            let finalTranscript = [...transcriptRef.current];
            if(interimTextRef.current.trim()) {
                 const duration = (Date.now() - startTimeRef.current) / 1000;
                 finalTranscript.push({ text: interimTextRef.current, startTime: duration });
            }
            if (finalTranscript.length > 0) {
                onTranscriptionComplete(finalTranscript);
            }
        }
        
        if (!isError) {
            setTranscript([]);
            setInterimText('');
        }

        if (connectionStatus !== 'error') {
             setConnectionStatus('idle');
        }
    }, [onTranscriptionComplete, connectionStatus]);

    const startRecording = async () => {
        setTranscript([]);
        setInterimText('');
        setError(null);

        try {
            if (!isApiKeyReady) {
              setError("Please configure your API key in settings to use live transcription.");
              onOpenSettings();
              return;
            }
            
            setIsRecording(true);
            setConnectionStatus('connecting');
            startTimeRef.current = Date.now();
            
            const ai = getAi();
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: () => {
                        setConnectionStatus('connected');
                        if (!mediaStreamRef.current) return;
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                        const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
                        scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
                        
                        scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };

                        source.connect(scriptProcessorRef.current);
                        scriptProcessorRef.current.connect(audioContextRef.current.destination);
                    },
                    onmessage: handleMessage,
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        setError('A connection error occurred.');
                        setConnectionStatus('error');
                        stopRecording(true);
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('Live session closed.');
                        if (connectionStatus !== 'error') {
                            setConnectionStatus('closed');
                        }
                    },
                },
                config: {
                    systemInstruction: "You are a highly accurate transcription service for academic lectures. Prioritize correct spelling of technical terms, proper nouns, and complex vocabulary. Your sole function is to transcribe the audio you receive with the highest possible accuracy.",
                    inputAudioTranscription: {},
                    responseModalities: [Modality.AUDIO],
                },
            });

        } catch (err) {
            console.error("Failed to start recording:", err);
            const errorMessage = err instanceof Error && err.message.includes("API_KEY")
                ? "Please configure your API key in settings to use live transcription."
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
    
    const transcriptText = transcript.map(s => s.text).join(' ');

    return (
        <div className="relative flex-1 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 p-8 text-center">
            {renderConnectionStatus()}
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Live Note Taker</h2>
            <p className="text-gray-600 dark:text-gray-400 mb-8 max-w-lg">
                Click the microphone to start recording your lecture. Your words will be transcribed in real-time.
            </p>
            
            <div className="mb-8">
                {!isRecording ? (
                    <button onClick={startRecording} className="bg-indigo-600 text-white rounded-full p-6 hover:bg-indigo-700 transition-all duration-200 shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:ring-indigo-500">
                        <MicIcon className="w-12 h-12" />
                    </button>
                ) : (
                    <button onClick={() => stopRecording()} className="bg-red-600 text-white rounded-full p-6 hover:bg-red-700 transition-all duration-200 shadow-lg animate-pulse focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-50 dark:focus:ring-offset-gray-800 focus:ring-red-500">
                        <StopIcon className="w-12 h-12" />
                    </button>
                )}
            </div>

            <div className="w-full max-w-3xl h-64 bg-white dark:bg-gray-900 rounded-lg p-4 overflow-y-auto border border-gray-200 dark:border-gray-700">
                <p className="text-left text-gray-800 dark:text-gray-300 whitespace-pre-wrap">
                    {transcriptText}
                    <span className="text-gray-600 dark:text-gray-400">{interimText}</span>
                    {!transcriptText && !interimText && <span className="text-gray-400 dark:text-gray-500">Waiting for audio...</span>}
                </p>
            </div>
            {error && <p className="text-red-500 dark:text-red-400 mt-4">{error}</p>}
        </div>
    );
};

export default LiveNoteTaker;