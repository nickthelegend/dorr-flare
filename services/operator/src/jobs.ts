import { randomBytes } from "node:crypto";
import { getState, persist, type Job } from "./state.js";

export function createJob(kind: Job["kind"], refId: string): Job {
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind,
    refId,
    status: "running",
    steps: [],
    createdAt: new Date().toISOString(),
  };
  getState().jobs.push(job);
  persist();
  return job;
}

export function jobStep(job: Job, label: string): { done: (patch?: { detail?: string; txHash?: string }) => void; fail: (detail: string) => void } {
  const step: Job["steps"][number] = { label, status: "running" };
  const startedAt = Date.now();
  job.steps.push(step);
  persist();
  return {
    done: (patch) => {
      step.status = "complete";
      step.ms = Date.now() - startedAt;
      if (patch?.detail) step.detail = patch.detail;
      if (patch?.txHash) step.txHash = patch.txHash;
      persist();
    },
    fail: (detail) => {
      step.status = "error";
      step.ms = Date.now() - startedAt;
      step.detail = detail;
      persist();
    },
  };
}

export function completeJob(job: Job): void {
  job.status = "complete";
  job.completedAt = new Date().toISOString();
  persist();
}

export function failJob(job: Job, error: string): void {
  job.status = "error";
  job.error = error;
  job.completedAt = new Date().toISOString();
  persist();
}

export function getJob(id: string): Job | undefined {
  return getState().jobs.find((j) => j.id === id);
}
