import type http from 'node:http';

export const MIME: Record<string, string>;
export interface StaticServer {
  url: string;
  port: number;
  server: http.Server;
  setRoot(root: string): void;
  close(): Promise<void>;
}
export function serveDir(root: string, opts?: { gzip?: boolean }): Promise<StaticServer>;
