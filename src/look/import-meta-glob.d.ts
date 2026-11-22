// The one Vite feature src/look/credits.ts uses outside vite/client's types: a build-time glob that lists files (here, the lock files under
// public/look). Declared narrowly so the project's tsconfig keeps "types": ["node"].
interface ImportMeta {
  glob(pattern: string, options?: { query?: string; import?: string; eager?: false }): Record<string, () => Promise<unknown>>;
}
