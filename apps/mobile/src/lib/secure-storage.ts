import * as SecureStore from 'expo-secure-store';

/**
 * Supabase session storage backed by the device keychain/keystore.
 *
 * Some iOS releases reject SecureStore values above ~2 KB, and a Supabase
 * session (access + refresh token) is larger than that. Values are therefore
 * split into chunks with a small manifest entry recording the chunk count.
 */
const CHUNK_SIZE = 1800;

function safeKey(key: string): string {
  // SecureStore keys may only contain alphanumerics, ".", "-" and "_".
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function removeChunks(base: string): Promise<void> {
  const count = Number(await SecureStore.getItemAsync(`${base}.n`)) || 0;
  await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${base}.${i}`)));
  await SecureStore.deleteItemAsync(`${base}.n`);
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const base = safeKey(key);
    const count = Number(await SecureStore.getItemAsync(`${base}.n`));
    if (!count) return null;
    const parts = await Promise.all(Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${base}.${i}`)));
    // A missing chunk means the stored session is incomplete — treat it as signed out.
    if (parts.some((p) => p === null)) return null;
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    const base = safeKey(key);
    await removeChunks(base);
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) chunks.push(value.slice(i, i + CHUNK_SIZE));
    await Promise.all(chunks.map((chunk, i) => SecureStore.setItemAsync(`${base}.${i}`, chunk)));
    await SecureStore.setItemAsync(`${base}.n`, String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    await removeChunks(safeKey(key));
  },
};
