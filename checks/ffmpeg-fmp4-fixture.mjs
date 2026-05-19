import http from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {
    host: '127.0.0.1',
    port: 18080,
    path: '/stream.fmp4',
    healthPath: '/healthz',
    input: 'G:\\MTX\\fmp4test.mp4'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const readValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      i += 1;
      return value;
    };

    switch (key) {
      case 'host':
        options.host = readValue();
        break;
      case 'port':
        options.port = Number(readValue());
        break;
      case 'path':
        options.path = readValue();
        break;
      case 'health-path':
        options.healthPath = readValue();
        break;
      case 'input':
        options.input = readValue();
        break;
      case 'help':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option --${key}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  node checks/ffmpeg-fmp4-fixture.mjs [options]

Options:
  --input G:\\MTX\\fmp4test.mp4   Input MP4 file to loop
  --host 127.0.0.1                Listen host
  --port 18080                    Listen port
  --path /stream.fmp4             Stream path
  --health-path /healthz          Health check path
`);
}

function createFfmpegProcess(input) {
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-re',
    '-stream_loop',
    '-1',
    '-i',
    input,
    '-map',
    '0',
    '-c',
    'copy',
    '-f',
    'mp4',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1'
  ];

  return spawn('ffmpeg', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!existsSync(options.input)) {
    throw new Error(`Input file not found: ${options.input}`);
  }

  const active = new Set();
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${options.host}:${options.port}`}`);
    if (requestUrl.pathname === options.healthPath) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end('ok');
      return;
    }

    if (requestUrl.pathname !== options.path) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end();
      return;
    }

    const child = createFfmpegProcess(options.input);
    active.add(child);
    let closed = false;
    let headersSent = false;
    let bufferedChunks = [];

    const cleanup = () => {
      if (closed) return;
      closed = true;
      active.delete(child);
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    };

    const sendHeaders = () => {
      if (headersSent) return;
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-store, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Transfer-Encoding': 'chunked'
      });
      for (const chunk of bufferedChunks) {
        res.write(chunk);
      }
      bufferedChunks = [];
    };

    child.stdout.on('data', (chunk) => {
      if (closed) return;
      if (!headersSent) {
        bufferedChunks.push(Buffer.from(chunk));
        sendHeaders();
        return;
      }
      res.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      process.stderr.write(`[ffmpeg-fmp4] ${chunk}`);
    });

    child.on('error', (err) => {
      if (closed) return;
      if (!headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`ffmpeg spawn failed: ${err.message}`);
      } else {
        try {
          res.destroy(err);
        } catch {
          // ignore
        }
      }
      cleanup();
    });

    child.on('exit', (code, signal) => {
      active.delete(child);
      if (closed) return;
      if (!headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`ffmpeg exited before producing data: code=${code} signal=${signal || ''}`.trim());
      } else {
        try {
          res.end();
        } catch {
          // ignore
        }
      }
      cleanup();
    });

    req.on('close', cleanup);
    res.on('close', cleanup);
  });

  server.listen(options.port, options.host, () => {
    console.log(`ffmpeg fMP4 fixture listening on http://${options.host}:${options.port}${options.path}`);
    console.log(`Health check: http://${options.host}:${options.port}${options.healthPath}`);
    console.log(`Input: ${options.input}`);
  });

  const shutdown = () => {
    for (const child of active) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref?.();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
