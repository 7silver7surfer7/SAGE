/**
 * Prisma's validation errors dump the ENTIRE input object before the actual
 * complaint ("Unknown arg `x`", "Argument `y` is missing", "Got invalid
 * value") — for a drop/collection create that includes a long AI-written
 * description, the real problem sits after a multi-KB wall of text. Any
 * caller that truncates e.message to a short toast (as every API route here
 * does) ends up showing the description text and cutting off before the
 * actual reason — exactly the unreadable "Invalid `prisma...` description:
 * '...'" errors reported from the ZIP/drop launcher.
 *
 * This pulls out just the line that names the real problem, so a truncated
 * toast is still actionable.
 */
export function cleanPrismaError(err: any): string {
  const message: string = err?.message || String(err);
  if (!message.includes('Invalid `prisma.')) return message;
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  const complaint = lines.find(
    (l) =>
      l.startsWith('Unknown arg') ||
      l.startsWith('Argument ') ||
      l.startsWith('Missing') ||
      l.includes('is missing') ||
      l.includes('Got invalid value') ||
      l.includes('Value needed')
  );
  return complaint || message.slice(0, 200);
}
