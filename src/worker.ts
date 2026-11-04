interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  error?: string;
}

interface D1PreparedStatement {
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  DB?: D1Database;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      if (!env.DB) {
        return json({
          status: 'not_configured',
          database: 'unbound',
          message: 'Cloudflare D1 binding DB has not been configured yet.',
        }, 503);
      }

      try {
        const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
        return json({
          status: result?.ok === 1 ? 'ok' : 'degraded',
          database: 'connected',
          persistence: 'D1 connection verified',
        }, result?.ok === 1 ? 200 : 503);
      } catch {
        return json({
          status: 'error',
          database: 'connection_failed',
          message: 'D1 health check failed.',
        }, 503);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404);
    }

    // Static assets are served by the Workers assets binding.
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
};
