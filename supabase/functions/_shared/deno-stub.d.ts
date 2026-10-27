/**
 * The smallest stand-in for the Deno globals an Edge Function touches, so `tsc` can check
 * `supabase/functions/*\/index.ts` in CI without a Deno runtime installed.
 *
 * It is not a Deno emulator and it is not shipped: the Supabase CLI bundles each function
 * directory on its own, and `_shared` contains only this type file. What it buys is a real
 * type error — a typo, a wrong property, a missing await — caught before `functions deploy`
 * replaces a working function with a broken one.
 */
declare namespace Deno {
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
  function serve(
    options: { port?: number; hostname?: string; onListen?: (address: { port: number }) => void },
    handler: (request: Request) => Response | Promise<Response>,
  ): void;
  namespace env {
    function get(name: string): string | undefined;
    function toObject(): Record<string, string>;
  }
}
