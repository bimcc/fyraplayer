export interface ParsedUrl {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
}

export interface PathVars {
  app: string;
  stream: string;
  path: string;
  fullPath: string;
}

type PathVarKey = keyof PathVars;

export function parseUrl(inputUrl: string): ParsedUrl {
  const normalized = inputUrl
    .replace(/^rtmp:\/\//, 'http://')
    .replace(/^rtsp:\/\//, 'http://')
    .replace(/^srt:\/\//, 'http://')
    .replace(/^webrtc:\/\//, 'https://');
  const url = new URL(normalized);
  return {
    protocol: inputUrl.split('://')[0],
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search
  };
}

export function extractVars(pathname: string): PathVars {
  const parts = pathname.split('/').filter(Boolean);
  return {
    app: parts[0] || '',
    stream: parts[1] || '',
    path: pathname,
    fullPath: parts.join('/')
  };
}

export function buildUrl(
  hostname: string,
  port: number | string | undefined,
  pathTemplate: string | undefined,
  vars: PathVars,
  useOrigin: boolean,
  useHttps: boolean
): string | undefined {
  if (!pathTemplate) return undefined;
  let path = pathTemplate;
  (Object.keys(vars) as PathVarKey[]).forEach((key) => {
    path = path.replace(new RegExp(`\\{${key}\\}`, 'g'), vars[key]);
  });
  if (useOrigin && typeof window !== 'undefined') {
    return `${window.location.origin}${path}`;
  }
  const protocol = useHttps ? 'https' : 'http';
  const portStr = port ? `:${port}` : '';
  return `${protocol}://${hostname}${portStr}${path}`;
}
