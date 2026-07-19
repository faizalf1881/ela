import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { SessionUser } from "./auth";

export type AuditActor = { type: string; id?: string; label?: string };

/** Build an audit actor from a session (or "system" when unauthenticated). */
export function actorFrom(session: SessionUser | null | undefined): AuditActor {
  if (!session) return { type: "system" };
  return {
    type: session.role,
    id: session.sub,
    label: session.username || session.phone || session.name,
  };
}

function clientMeta(req?: Request) {
  if (!req) return { ip: undefined as string | undefined, userAgent: undefined as string | undefined };
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || undefined;
  const userAgent = h.get("user-agent") || undefined;
  return { ip, userAgent };
}

/**
 * Records one audit-trail row. Best-effort: never throws, so it can't break the
 * request it's logging.
 */
export async function audit(params: {
  actor: AuditActor;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}): Promise<void> {
  const { ip, userAgent } = clientMeta(params.req);
  try {
    await prisma.auditLog.create({
      data: {
        actorType: params.actor.type,
        actorId: params.actor.id ?? null,
        actorLabel: params.actor.label ?? null,
        action: params.action,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        summary: params.summary ?? null,
        metadata: params.metadata === undefined ? undefined : (params.metadata as Prisma.InputJsonValue),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[audit] failed to record:", params.action, e);
  }
}
