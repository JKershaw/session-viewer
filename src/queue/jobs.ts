import type { MangoCollection } from '@jkershaw/mangodb';
import { getCollection } from '../db/client.js';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AnalysisJob {
  id: string;
  sessionId: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: {
    annotationCount: number;
  };
  [key: string]: unknown;
}

export interface JobQueue {
  enqueue: (sessionId: string) => Promise<AnalysisJob>;
  getJob: (jobId: string) => Promise<AnalysisJob | null>;
  getJobBySessionId: (sessionId: string) => Promise<AnalysisJob | null>;
  getAllJobs: () => Promise<AnalysisJob[]>;
  updateJob: (job: AnalysisJob) => Promise<void>;
}

export const createJobQueue = async (): Promise<JobQueue> => {
  let collection: MangoCollection<AnalysisJob> | null = null;

  const getJobCollection = async (): Promise<MangoCollection<AnalysisJob>> => {
    if (!collection) {
      collection = await getCollection<AnalysisJob>('analysis_jobs');
    }
    return collection;
  };

  const enqueue = async (sessionId: string): Promise<AnalysisJob> => {
    const coll = await getJobCollection();

    // Check if there's already a pending/processing job for this session
    const allJobs = await coll.find({}).toArray();
    const existing = allJobs.find(
      (j) => j.sessionId === sessionId && (j.status === 'pending' || j.status === 'processing')
    );

    if (existing) {
      return existing;
    }

    const job: AnalysisJob = {
      id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      sessionId,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    await coll.insertOne(job);
    return job;
  };

  const getJob = async (jobId: string): Promise<AnalysisJob | null> => {
    const coll = await getJobCollection();
    return await coll.findOne({ id: jobId });
  };

  const getJobBySessionId = async (sessionId: string): Promise<AnalysisJob | null> => {
    const coll = await getJobCollection();
    const jobs = await coll.find({ sessionId }).toArray();
    const sorted = jobs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    return sorted[0] ?? null;
  };

  const getAllJobs = async (): Promise<AnalysisJob[]> => {
    const coll = await getJobCollection();
    return await coll.find({}).toArray();
  };

  const updateJob = async (job: AnalysisJob): Promise<void> => {
    const coll = await getJobCollection();
    await coll.updateOne({ id: job.id }, { $set: job });
  };

  return { enqueue, getJob, getJobBySessionId, getAllJobs, updateJob };
};
