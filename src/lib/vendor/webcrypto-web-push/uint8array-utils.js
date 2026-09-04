// Local reimplementation of the handful of uint8array-extras functions
// @block65/webcrypto-web-push needs, so this vendored copy has zero
// npm dependencies. See ../../../../src/lib/web-push.ts for why this is
// vendored at all rather than imported from node_modules — the real
// npm package makes OpenNext's esbuild bundling step crash with
// `Cannot read directory ".../node_modules/WebPush: info\0"`, reproduced
// locally and confirmed independent of Turbopack vs. webpack. Root cause
// not fully diagnosed under time constraints; vendoring (source
// unchanged, MIT-licensed, see LICENSE.md) sidesteps whatever OpenNext
// does specifically for real node_modules entries.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toUint8Array(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}

export function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) return new Uint8Array(0);
  const length = totalLength ?? arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }
  return result;
}

export function stringToUint8Array(string) {
  return encoder.encode(string);
}

export function uint8ArrayToString(array) {
  return decoder.decode(array);
}

function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - (base64.length % 4)) % 4;
  return base64 + "=".repeat(padding);
}

const MAX_BLOCK_SIZE = 65_536;

export function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(undefined, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}

export function base64ToUint8Array(base64String) {
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
