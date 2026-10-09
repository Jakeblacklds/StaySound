import { decode as decodeBase64 } from "base-64";
import * as FileSystem from "expo-file-system/legacy";

function decodeBase64ToBytes(base64Value: string): Uint8Array {
  const decoded = decodeBase64(base64Value);
  const bytes = new Uint8Array(decoded.length);

  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index) & 0xff;
  }

  return bytes;
}

function bytesIncludeAscii(bytes: Uint8Array, value: string): boolean {
  if (!value || bytes.length < value.length) return false;

  for (let offset = 0; offset <= bytes.length - value.length; offset++) {
    let matched = true;
    for (let index = 0; index < value.length; index++) {
      if (bytes[offset + index] !== value.charCodeAt(index)) {
        matched = false;
        break;
      }
    }

    if (matched) return true;
  }

  return false;
}

function hasIsoBmffHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;

  const knownBoxes = new Set([
    "ftyp",
    "styp",
    "moov",
    "moof",
    "mdat",
  ]);

  for (let offset = 0; offset <= bytes.length - 8; offset++) {
    const boxType = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );

    if (knownBoxes.has(boxType)) {
      return true;
    }
  }

  return false;
}

function hasMp3FrameSync(bytes: Uint8Array): boolean {
  for (let index = 0; index < bytes.length - 1; index++) {
    if (bytes[index] === 0xff && (bytes[index + 1] & 0xe0) === 0xe0) {
      return true;
    }
  }

  return false;
}

export async function isValidAudioFile(
  uri: string,
  extension: string,
): Promise<boolean> {
  try {
    const base64Prefix = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 96,
    } as never);

    const prefixBytes = decodeBase64ToBytes(base64Prefix);

    if (extension === "flac") {
      return bytesIncludeAscii(prefixBytes, "fLaC");
    }

    if (extension === "m4a") {
      return hasIsoBmffHeader(prefixBytes);
    }

    if (extension === "mp3") {
      return bytesIncludeAscii(prefixBytes, "ID3") || hasMp3FrameSync(prefixBytes);
    }

    return true; // fallback
  } catch {
    return false;
  }
}
