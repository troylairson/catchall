// The app modules the server shares (teams, feeds) reference browser storage inside functions the
// server never calls. Declared here only so the server typechecks.
declare const localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void };
declare const window: { dispatchEvent(e: Event): boolean };
interface ImportMeta {
  env?: { DEV?: boolean };
}
