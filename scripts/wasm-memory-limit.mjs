/** Check the module's real memory declaration, independently of profile metadata. */
export function verifyMemoryLimit(memory, bytes) {
  const previous = memory.buffer.byteLength / 65536;
  const maximum = bytes / 65536;
  if (!Number.isSafeInteger(maximum) || maximum < previous)
    throw new Error("Invalid WASM memory profile");
  if (memory.grow(maximum - previous) !== previous)
    throw new Error("WASM memory did not reach the declared ceiling");
  let refused = false;
  try {
    memory.grow(1);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    refused = true;
  }
  if (!refused) throw new Error("WASM memory exceeds the declared ceiling");
}
