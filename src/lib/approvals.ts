// In-memory approval store for dangerous commands.
// The chat stream pauses (with heartbeats) until the user approves/denies
// via POST /api/approval, or a timeout occurs.

export const APPROVAL_TIMEOUT_MS = 180_000;

export type ApprovalVerdict = "approved" | "denied" | "timeout";

interface PendingApproval {
  id: string;
  toolId: string;
  command: string;
  reason: string;
  createdAt: number;
  resolve: (v: ApprovalVerdict) => void;
}

const globalForApprovals = globalThis as unknown as {
  __jarvisApprovals?: Map<string, PendingApproval>;
};
const pending: Map<string, PendingApproval> =
  globalForApprovals.__jarvisApprovals ?? new Map();
globalForApprovals.__jarvisApprovals = pending;

let counter = 0;

export function createApproval(toolId: string, command: string, reason: string) {
  const id = `appr_${Date.now()}_${++counter}`;
  let resolveFn: (v: ApprovalVerdict) => void = () => {};
  const promise = new Promise<ApprovalVerdict>((resolve) => {
    resolveFn = resolve;
  });
  pending.set(id, {
    id,
    toolId,
    command,
    reason,
    createdAt: Date.now(),
    resolve: resolveFn,
  });
  return {
    id,
    promise,
    cancel() {
      const entry = pending.get(id);
      if (entry) {
        entry.resolve("timeout");
        pending.delete(id);
      }
    },
  };
}

export function resolveApproval(id: string, approved: boolean): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  entry.resolve(approved ? "approved" : "denied");
  pending.delete(id);
  return true;
}

export function listPendingApprovals() {
  return [...pending.values()].map((p) => ({
    id: p.id,
    toolId: p.toolId,
    command: p.command,
    reason: p.reason,
    createdAt: p.createdAt,
  }));
}
