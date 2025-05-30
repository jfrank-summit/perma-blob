/**
 * JSON.stringify replacer function to convert BigInt values to strings.
 * @param _key The key being serialized (unused, following convention).
 * @param value The value being serialized.
 * @returns The original value, or the string representation if the value is a BigInt.
 */
export const bigIntReplacer = (_key: string, value: any): any => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
};

/**
 * JSON.parse reviver function to convert specific string fields back to BigInt.
 * Currently targets 'blockNumber' and 'timestamp' keys.
 * @param key The key being deserialized.
 * @param value The value being deserialized.
 * @returns The original value, or a BigInt if the key matches and value is a parsable string.
 */
export const bigIntReviver = (key: string, value: any): any => {
  if (key === 'blockNumber' || key === 'timestamp') { 
    if (typeof value === 'string') {
      try {
        return BigInt(value);
      } catch (e) {
        // Using console.warn for simple logging in this utility.
        // The consuming service logger can provide more context if needed.
        console.warn(`[json-utils] Failed to parse BigInt for key '${key}', value '${value}'. Returning original string. Error: ${(e as Error).message}`);
        return value; // Return original string if parsing fails
      }
    }
  }
  return value;
}; 