import { mkdirSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** Dev only: POST /__shot?name=x with a PNG data URL saves shots/x.png (screenshots from a throttled tab). */
const shots: Plugin = {
  name: 'lookdev-shots',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      const name = new URL(req.url ?? '', 'http://x').searchParams.get('name')?.replace(/[^\w-]/g, '') || 'shot';
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        mkdirSync('shots', { recursive: true });
        writeFileSync(`shots/${name}.png`, Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64'));
        res.end('ok');
      });
    });
  },
};

export default defineConfig({
  plugins: [shots],
  server: { port: 5181, strictPort: true, watch: { ignored: ['**/shots/**'] } },
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
