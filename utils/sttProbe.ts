export interface SttProbeStats {
  startedAtMs: number;
  endedAtMs?: number;
  firstInterimAtMs?: number;
  lastInterimAtMs?: number;
  firstFinalAtMs?: number;
  interimEventsCount: number;
  finalEventsCount: number;
  reconnectCount: number;
  audioFramesSent: number;
  audioFramesDropped: number;
  queueDepthTotal: number;
  queueDepthSamples: number;
  wsCloseReason?: string;
}

export interface SttProbeSummary {
  time_to_first_interim_ms: number | null;
  interim_events_count: number;
  interim_cadence_per_sec: number;
  time_to_first_final_ms: number | null;
  final_events_count: number;
  reconnect_count: number;
  ws_open_to_close_reason: string | null;
  audio_frames_sent: number;
  audio_frames_dropped: number;
  avg_frame_queue_depth: number | null;
  duration_ms: number;
}

let lastProbeSummary: SttProbeSummary | null = null;

export const setLastSttProbeSummary = (summary: SttProbeSummary | null) => {
  lastProbeSummary = summary;
};

export const getLastSttProbeSummary = (): SttProbeSummary | null => lastProbeSummary;

export const createSttProbeStats = (startedAtMs = Date.now()): SttProbeStats => ({
  startedAtMs,
  interimEventsCount: 0,
  finalEventsCount: 0,
  reconnectCount: 0,
  audioFramesSent: 0,
  audioFramesDropped: 0,
  queueDepthTotal: 0,
  queueDepthSamples: 0,
});

export const recordSttProbeInterim = (stats: SttProbeStats, eventAtMs: number): SttProbeStats => {
  const firstInterimAtMs = stats.firstInterimAtMs ?? eventAtMs;
  return {
    ...stats,
    firstInterimAtMs,
    lastInterimAtMs: eventAtMs,
    interimEventsCount: stats.interimEventsCount + 1,
  };
};

export const recordSttProbeFinal = (stats: SttProbeStats, eventAtMs: number): SttProbeStats => ({
  ...stats,
  firstFinalAtMs: stats.firstFinalAtMs ?? eventAtMs,
  finalEventsCount: stats.finalEventsCount + 1,
});

export const recordSttProbeReconnect = (stats: SttProbeStats): SttProbeStats => ({
  ...stats,
  reconnectCount: stats.reconnectCount + 1,
});

export const recordSttProbeAudioSent = (stats: SttProbeStats, count = 1): SttProbeStats => ({
  ...stats,
  audioFramesSent: stats.audioFramesSent + count,
});

export const recordSttProbeAudioDropped = (stats: SttProbeStats, count = 1): SttProbeStats => ({
  ...stats,
  audioFramesDropped: stats.audioFramesDropped + count,
});

export const recordSttProbeQueueDepth = (stats: SttProbeStats, depth: number): SttProbeStats => ({
  ...stats,
  queueDepthTotal: stats.queueDepthTotal + depth,
  queueDepthSamples: stats.queueDepthSamples + 1,
});

export const recordSttProbeClose = (stats: SttProbeStats, reason?: string): SttProbeStats => ({
  ...stats,
  wsCloseReason: reason ?? stats.wsCloseReason,
});

export const finalizeSttProbeStats = (stats: SttProbeStats, endedAtMs = Date.now()): SttProbeSummary => {
  const durationMs = Math.max(0, endedAtMs - stats.startedAtMs);
  const firstInterimMs = stats.firstInterimAtMs ? stats.firstInterimAtMs - stats.startedAtMs : null;
  const firstFinalMs = stats.firstFinalAtMs ? stats.firstFinalAtMs - stats.startedAtMs : null;
  const cadenceWindowMs = durationMs > 0 ? durationMs : 0;
  const interimCadence = cadenceWindowMs > 0
    ? Number((stats.interimEventsCount / (cadenceWindowMs / 1000)).toFixed(2))
    : 0;
  const avgQueueDepth = stats.queueDepthSamples > 0
    ? Number((stats.queueDepthTotal / stats.queueDepthSamples).toFixed(2))
    : null;

  return {
    time_to_first_interim_ms: firstInterimMs,
    interim_events_count: stats.interimEventsCount,
    interim_cadence_per_sec: interimCadence,
    time_to_first_final_ms: firstFinalMs,
    final_events_count: stats.finalEventsCount,
    reconnect_count: stats.reconnectCount,
    ws_open_to_close_reason: stats.wsCloseReason ?? null,
    audio_frames_sent: stats.audioFramesSent,
    audio_frames_dropped: stats.audioFramesDropped,
    avg_frame_queue_depth: avgQueueDepth,
    duration_ms: durationMs,
  };
};
