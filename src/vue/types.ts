export type SurfaceMessageTextPart = {
  type: 'text';
  text: string;
};

export type SurfaceMessageStatusPart = {
  type: 'status';
  text: string;
};

export type SurfaceMessageToolPart = {
  type: 'tool';
  id: string;
  title: string;
  kind?: string;
  status: 'running' | 'completed' | 'failed';
  statusText?: string;
  body?: string;
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
};

export type SurfaceMessagePart =
  | SurfaceMessageTextPart
  | SurfaceMessageStatusPart
  | SurfaceMessageToolPart;

export type SurfaceMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  status: 'complete' | 'streaming' | 'error';
  parts: SurfaceMessagePart[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

