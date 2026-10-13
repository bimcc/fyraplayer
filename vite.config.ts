import { defineConfig } from 'vite';
import path from 'path';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

export default defineConfig({
  root: path.resolve(__dirname, 'examples'),
  base: './',
  plugins: [{
    name: 'standalone-iife-example',
    configureServer(server) {
      server.middlewares.use('/sdk/fyraplayer.iife.js', (_req, res) => {
        const file = path.resolve(__dirname, 'dist/fyraplayer.iife.js');
        if (!existsSync(file)) {
          res.statusCode = 503;
          res.end('Run pnpm build:release before opening minimal-iife.html');
          return;
        }
        res.setHeader('Content-Type', 'application/javascript');
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      const output = path.resolve(__dirname, 'site-dist');
      mkdirSync(path.join(output, 'sdk'), { recursive: true });
      copyFileSync(path.resolve(__dirname, 'dist/fyraplayer.iife.js'), path.join(output, 'sdk/fyraplayer.iife.js'));
      cpSync(path.resolve(__dirname, 'dist/licenses'), path.join(output, 'sdk/licenses'), { recursive: true });
      copyFileSync(path.resolve(__dirname, 'THIRD_PARTY_NOTICES.md'), path.join(output, 'sdk/THIRD_PARTY_NOTICES.md'));
      copyFileSync(path.resolve(__dirname, 'dist/vendor/dash.all.min.js.LICENSE.txt'), path.join(output, 'sdk/dash.all.min.js.LICENSE.txt'));
      copyFileSync(path.resolve(__dirname, 'examples/minimal-iife.html'), path.join(output, 'minimal-iife.html'));
    }
  }],
  build: {
    outDir: path.resolve(__dirname, 'site-dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        basic: path.resolve(__dirname, 'examples/basic.html'),
        multiview: path.resolve(__dirname, 'examples/multiview.html'),
        panoramalite: path.resolve(__dirname, 'examples/panoramalite.html')
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      // 代理 OvenMediaEngine LLHLS/HLS
      '/ome': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ome/, '')
      },
      '/ffmpeg-fmp4': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ffmpeg-fmp4/, '')
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
