import { NextResponse } from "next/server";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wraps a route handler body so every route gets the same error shape
 * without repeating try/catch everywhere. Business-rule failures (bad input,
 * missing record) should throw a plain Error with a user-facing message —
 * anything else is logged and reported as a generic 500.
 */
export async function withErrorHandling(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonError(message, 500);
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field: ${field}`);
  }
  return value.trim();
}
