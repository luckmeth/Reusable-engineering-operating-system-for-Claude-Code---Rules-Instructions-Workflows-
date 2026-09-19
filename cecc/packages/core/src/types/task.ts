import type { WorkflowStage } from './workflow.js';

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE', 'VERIFIED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  stage: WorkflowStage | null;
  /** Task ids this one waits on. */
  dependencies: string[];
  affectedFiles: string[];
  /** Test names or file paths that prove this task works. */
  tests: string[];
  securityChecks: string[];
  acceptanceCriteria: string[];
  /** Event ids proving the work happened. DONE needs some; VERIFIED needs more. */
  evidenceEventIds: string[];
  /** Where the task came from: 'user' | 'docs' | 'todo-scan' | 'cecc'. */
  origin: string;
  createdAt: string;
  updatedAt: string;
}

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<Task, 'id' | 'createdAt' | 'updatedAt'>>;
