import { Router, type Request, type Response } from 'express';
import type { JobQueue } from '../../queue/jobs.js';

export const createJobRoutes = (jobQueue?: JobQueue): Router => {
  const router = Router();

  // List all jobs
  router.get('/', async (_req: Request, res: Response) => {
    try {
      if (!jobQueue) {
        res.json([]);
        return;
      }
      const jobs = await jobQueue.getAllJobs();
      res.json(jobs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch jobs' });
    }
  });

  // Get single job
  router.get('/:jobId', async (req: Request, res: Response) => {
    try {
      if (!jobQueue) {
        res.status(404).json({ error: 'Job queue not initialized' });
        return;
      }
      const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
      const job = await jobQueue.getJob(jobId);
      if (!job) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      res.json(job);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  return router;
};
