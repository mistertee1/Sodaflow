/** Runtime secrets stay server-side. Netlify Functions use their own environment API. */
export function serverEnv(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & { Netlify?: { env: { get(key: string): string | undefined } } };
  return runtime.Netlify ? runtime.Netlify.env.get(name) : process.env[name];
}
export function onNetlify() { return Boolean((globalThis as any).Netlify); }
