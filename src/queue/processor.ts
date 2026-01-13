import type { JobQueue, AnalysisJob } from './jobs.js';
import type { SessionRepository } from '../db/sessions.js';
import {
  createOpenRouterClient,
  analyzeSession,
  getOpenRouterConfig
} from '../llm/openrouter.js';

export interface JobProcessor {
  start: (intervalMs?: number) => void;
  stop: () => void;
  processNextJob: () => Promise<void>;
  isProcessing: () => boolean;
}

export const createJobProcessor = (
  queue: JobQueue,
  sessionRepo: SessionRepository
): JobProcessor => {
  let processing = false;
  let intervalId: NodeJS.Timeout | null = null;

  const processNextJob = async (): Promise<void> => {
    if (processing) return;

    const jobs = await queue.getAllJobs();
    const pendingJob = jobs.find((j) => j.status === 'pending');
    if (!pendingJob) return;

    processing = true;

    try {
      // Mark as processing
      pendingJob.status = 'processing';
      pendingJob.startedAt = new Date().toISOString();
      await queue.updateJob(pendingJob);

      // Get session
      const session = await sessionRepo.getSession(pendingJob.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      // Get OpenRouter config
      const config = getOpenRouterConfig();
      if (!config) {
        throw new Error('OpenRouter not configured');
      }

      // Analyze session
      const client = createOpenRouterClient(config);
      const annotations = await analyzeSession(client, session);

      // Update session with annotations
      const updatedSession = { ...session, analyzed: true, annotations };
      await sessionRepo.upsertSession(updatedSession);

      // Mark job as completed
      pendingJob.status = 'completed';
      pendingJob.completedAt = new Date().toISOString();
      pendingJob.result = { annotationCount: annotations.length };
      await queue.updateJob(pendingJob);

      console.log(
        `Analysis completed for session ${pendingJob.sessionId}: ${annotations.length} annotations`
      );
    } catch (error) {
      pendingJob.status = 'failed';
      pendingJob.completedAt = new Date().toISOString();
      pendingJob.error = error instanceof Error ? error.message : 'Unknown error';
      await queue.updateJob(pendingJob);

      console.error(`Analysis failed for session ${pendingJob.sessionId}:`, error);
    } finally {
      processing = false;
    }
  };

  const start = (intervalMs = 2000): void => {
    if (intervalId) return;
    console.log(`Job processor started (polling every ${intervalMs}ms)`);
    intervalId = setInterval(processNextJob, intervalMs);
    // Process immediately on start
    processNextJob();
  };

  const stop = (): void => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('Job processor stopped');
    }
  };

  const isProcessing = (): boolean => processing;

  return { start, stop, processNextJob, isProcessing };
};
