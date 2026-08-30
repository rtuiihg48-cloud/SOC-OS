export function validatedIdempotencyKey(headerKey?: string, bodyKey?: string): string | null {
  const key = headerKey ?? bodyKey;
  return key && key.length <= 128 ? key : null;
}

/**
 * The success evidence is deliberately sequenced after the upstream call.
 * Failure evidence is distinct and can never be mistaken for accepted work.
 */
export async function auditedHandoff<T>(
  call: () => Promise<T>,
  recordAccepted: (result: T) => Promise<void>,
  recordFailed: (error: unknown) => Promise<void>,
): Promise<T> {
  let result: T;
  try {
    result = await call();
  } catch (error) {
    await recordFailed(error);
    throw error;
  }
  await recordAccepted(result);
  return result;
}