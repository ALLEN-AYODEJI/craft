import { defineConfig } from 'vitest/config';
import path from 'path';

/** Snapshot serializer that pretty-prints GeneratedFile arrays as a file tree. */
const generatedFileTreeSerializer = {
  test(val: unknown): boolean {
    return (
      Array.isArray(val) &&
      val.length > 0 &&
      typeof (val[0] as Record<string, unknown>).path === 'string' &&
      typeof (val[0] as Record<string, unknown>).content === 'string'
    );
  },
  print(val: unknown): string {
    const files = val as Array<{ path: string; content: string; type: string }>;
    return files
      .map(f => `── ${f.path} [${f.type}]\n${f.content.trimEnd()}`)
      .join('\n\n');
  },
};

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Shard safety: no mutable module-level singletons; each vi.mock is
    // reset in beforeEach. Safe to run with --shard=<index>/<total>.
    sequence: { shuffle: false },
    snapshotSerializers: [generatedFileTreeSerializer],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
