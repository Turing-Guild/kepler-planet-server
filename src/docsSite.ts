import fs from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';

interface DocsPage {
  label: string;
  routePath: string;
  sourcePath: string;
}

interface RenderedPage {
  contentType: string;
  status: number;
  body: string;
}

interface FrontmatterResult {
  attributes: Record<string, string>;
  body: string;
}

const docsRoot = process.cwd();
const docsJsonPath = path.join(docsRoot, 'docs.json');

export async function renderDocsPage(requestPath: string): Promise<RenderedPage> {
  const pages = await loadDocsPages();
  const requestedRoute = normalizeDocsRoute(requestPath);
  const routePath = requestedRoute === '/docs' ? '/docs/introduction' : requestedRoute;
  const page = pages.find((entry) => entry.routePath === routePath);

  if (!page) {
    return {
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: renderShell({
        title: 'Docs page not found',
        pages,
        activeRoute: routePath,
        content: '<h1>Docs page not found</h1><p>The requested documentation page does not exist.</p>',
      }),
    };
  }

  const source = await fs.readFile(path.join(docsRoot, page.sourcePath), 'utf8');
  const frontmatter = parseFrontmatter(source);
  const title = frontmatter.attributes.title || page.label;
  const description = frontmatter.attributes.description;
  const html = await marked.parse(frontmatter.body, {
    async: true,
    gfm: true,
  });

  return {
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: renderShell({
      title,
      description,
      pages,
      activeRoute: page.routePath,
      content: html,
    }),
  };
}

async function loadDocsPages(): Promise<DocsPage[]> {
  const docsJson = JSON.parse(await fs.readFile(docsJsonPath, 'utf8')) as {
    navigation?: {
      tabs?: Array<{
        groups?: Array<{
          pages?: string[];
        }>;
      }>;
    };
  };

  const rawPages = docsJson.navigation?.tabs?.flatMap((tab) => (
    tab.groups?.flatMap((group) => group.pages || []) || []
  )) || [];

  return Promise.all(rawPages.map(async (sourcePath) => {
    const source = await fs.readFile(path.join(docsRoot, `${sourcePath}.mdx`), 'utf8');
    const frontmatter = parseFrontmatter(source);
    return {
      label: frontmatter.attributes.title || titleFromPath(sourcePath),
      routePath: `/${sourcePath}`,
      sourcePath: `${sourcePath}.mdx`,
    };
  }));
}

function parseFrontmatter(source: string): FrontmatterResult {
  if (!source.startsWith('---\n')) {
    return { attributes: {}, body: source };
  }

  const end = source.indexOf('\n---\n', 4);
  if (end === -1) {
    return { attributes: {}, body: source };
  }

  const attributes: Record<string, string> = {};
  const rawFrontmatter = source.slice(4, end);
  for (const line of rawFrontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*"?([^"]*)"?$/);
    if (match) {
      attributes[match[1]] = match[2];
    }
  }

  return {
    attributes,
    body: source.slice(end + 5).trimStart(),
  };
}

function normalizeDocsRoute(requestPath: string): string {
  const pathname = requestPath.replace(/\/+$/, '') || '/docs';
  if (!pathname.startsWith('/docs')) {
    return '/docs';
  }
  return pathname;
}

function titleFromPath(sourcePath: string): string {
  return sourcePath.split('/').at(-1)?.split('-').map((word) => (
    `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`
  )).join(' ') || sourcePath;
}

function renderShell(input: {
  title: string;
  description?: string;
  pages: DocsPage[];
  activeRoute: string;
  content: string;
}): string {
  const nav = input.pages.map((page) => {
    const activeClass = page.routePath === input.activeRoute ? ' class="active"' : '';
    return `<a${activeClass} href="${escapeHtml(page.routePath)}">${escapeHtml(page.label)}</a>`;
  }).join('');

  const description = input.description
    ? `<p class="description">${escapeHtml(input.description)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)} | Kepler Planet Server</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f8fafc;
        --panel: #ffffff;
        --text: #111827;
        --muted: #64748b;
        --line: #dbe3ef;
        --accent: #2563eb;
        --code: #0f172a;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.6;
      }
      .layout {
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr);
        min-height: 100vh;
      }
      nav {
        border-right: 1px solid var(--line);
        background: var(--panel);
        padding: 28px 18px;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
      }
      .brand {
        display: block;
        color: var(--text);
        font-weight: 750;
        font-size: 18px;
        margin: 0 10px 18px;
        text-decoration: none;
      }
      nav a:not(.brand) {
        display: block;
        color: #334155;
        border-radius: 8px;
        padding: 8px 10px;
        text-decoration: none;
        font-size: 14px;
      }
      nav a:not(.brand):hover,
      nav a.active {
        background: #eaf1ff;
        color: var(--accent);
      }
      main {
        max-width: 920px;
        width: 100%;
        padding: 42px 34px 80px;
      }
      article {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 34px;
      }
      h1, h2, h3 {
        line-height: 1.2;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 36px;
      }
      h2 {
        border-top: 1px solid var(--line);
        margin-top: 34px;
        padding-top: 28px;
      }
      .description {
        color: var(--muted);
        font-size: 17px;
        margin: 0 0 26px;
      }
      a { color: var(--accent); }
      code {
        background: #eef2f7;
        border-radius: 5px;
        padding: 2px 5px;
        font-size: 0.9em;
      }
      pre {
        background: var(--code);
        border-radius: 8px;
        color: #e5edf7;
        overflow-x: auto;
        padding: 16px;
      }
      pre code {
        background: transparent;
        color: inherit;
        padding: 0;
      }
      blockquote {
        border-left: 4px solid var(--accent);
        color: #334155;
        margin-left: 0;
        padding-left: 16px;
      }
      @media (max-width: 820px) {
        .layout {
          display: block;
        }
        nav {
          height: auto;
          position: static;
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }
        main {
          padding: 20px 14px 48px;
        }
        article {
          padding: 22px;
        }
        h1 {
          font-size: 28px;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <nav>
        <a class="brand" href="/docs">Kepler Planet Server</a>
        ${nav}
      </nav>
      <main>
        <article>
          <h1>${escapeHtml(input.title)}</h1>
          ${description}
          ${input.content}
        </article>
      </main>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
