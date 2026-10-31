import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Runs our backend (api/index.js) inside the Vite dev server, so `npm run dev`
// serves the frontend AND /api on one port. No `vercel dev` needed locally.
// Backend edits reload on the next request. In production, Vercel runs api/index.js itself.
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        const send = (status, obj) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(obj));
        };
        try {
          // Connect strips the "/api" prefix, so req.url is e.g. "/auth/me?x=1".
          const url = new URL(req.url, 'http://localhost');
          let raw = '';
          for await (const chunk of req) raw += chunk;
          let body = {};
          if (raw) {
            try { body = JSON.parse(raw); } catch { return send(400, { error: 'Body must be valid JSON' }); }
          }
          req.query = { ...Object.fromEntries(url.searchParams), route: url.pathname.replace(/^\/+/, '') };
          req.body = body;
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (obj) => { send(res.statusCode || 200, obj); return res; };

          const { default: handler } = await server.ssrLoadModule('/api/index.js');
          await handler(req, res);
        } catch (err) {
          server.ssrFixStacktrace(err);
          console.error('[local-api]', err);
          send(500, { error: err.message });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Make .env / .env.local available to the backend (SUPABASE_*, ANTHROPIC_API_KEY, ...).
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return {
    plugins: [react(), tailwindcss(), localApi()],
    server: { port: 3000 },
  };
});
