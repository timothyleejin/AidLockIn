// Human-facing identifiers. Real primary keys are always UUIDs (DSQL has no
// auto-incrementing serials, and random UUIDs distribute writes evenly across
// the cluster) — these are just the short codes people read off a screen.

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I confusion

function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/** Household claim code, e.g. HX-8N2V. No name attached — see NFR4. */
export function generateClaimCode(): string {
  return `HX-${randomCode(4)}`;
}

/** Idempotency key for a single "Check & allocate" tap. */
export function generateIdempotencyKey(): string {
  return `idem_${Date.now().toString(36)}_${randomCode(8).toLowerCase()}`;
}
