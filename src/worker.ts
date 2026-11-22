interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/**
 * Static frontend host only.
 * All authentication and application data access happens directly in the browser
 * through the user's Google OAuth session and Google Sheets API.
 * No D1 binding, server-side credentials, or application API endpoints remain.
 */
export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
