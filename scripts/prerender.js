/**
 * Build-time prerendering of route metadata.
 *
 * The app is a client-side SPA. To give crawlers and link previews proper
 * titles, descriptions and canonical URLs without a server renderer, this
 * Vite plugin writes dist/<route>/index.html copies of the shell with
 * route-specific <head> tags, plus robots.txt. Dynamic pages (discoveries,
 * regions) get metadata at request time from the functions in /api.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATIC_ROUTES = [
  { path: '/explore', title: 'Explore the regions', description: 'Browse every region of the shared organism — its state, energy and recent activity — without navigating the 3D world.' },
  { path: '/discoveries', title: 'Discoveries', description: 'Notable moments in the life of the organism: first traces, surges, new branches, new regions and community Convergences.' },
  { path: '/evolution', title: 'Evolution', description: 'How the organism changes: evolution stages, milestones, the timeline of recorded events, and historical world snapshots.' },
  { path: '/about', title: 'About', description: 'What Internet Organism is, how participation works, what changes the world, and what is simulated versus observed.' },
  { path: '/support', title: 'Support the organism', description: 'Help cover hosting and development. The organism stays free; support never buys control of the shared world.' },
  { path: '/privacy', title: 'Privacy policy', description: 'What data Internet Organism collects, why, and how long it is kept.' },
  { path: '/terms', title: 'Terms of use', description: 'Terms of use, community rules and moderation policy for Internet Organism.' },
  { path: '/settings', title: 'Settings', description: 'Motion, graphics, sound and privacy preferences.', noindex: true },
  { path: '/profile', title: 'Profile', description: 'Your traces, saved discoveries and account.', noindex: true },
  { path: '/admin', title: 'Administration', description: 'Operator tools.', noindex: true },
];

export function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Replace head metadata in the built shell. Pure, so it can be unit tested. */
export function applyMeta(html, { siteUrl, path, title, description, noindex = false, image = null }) {
  const fullTitle = `${title} · Internet Organism`;
  const url = `${siteUrl}${path}`;
  const img = image || `${siteUrl}/images/og-default.png`;
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(fullTitle)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeAttr(description)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escapeAttr(url)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeAttr(fullTitle)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapeAttr(description)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${escapeAttr(url)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${escapeAttr(img)}$2`)
    .replace(/(<meta name="robots" content=")[^"]*(")/, `$1${noindex ? 'noindex, nofollow' : 'index, follow'}$2`);
}

export function prerenderPlugin({ siteUrl }) {
  let outDir = 'dist';
  return {
    name: 'internet-organism-prerender',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const shellPath = join(outDir, 'index.html');
      if (!existsSync(shellPath)) return;
      const shellSource = readFileSync(shellPath, 'utf8');
      for (const r of STATIC_ROUTES) {
        const dir = join(outDir, r.path);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), applyMeta(shellSource, { siteUrl, ...r }));
      }
      // The function in /api serves the shell for dynamic routes.
      writeFileSync(join(outDir, 'app-shell.html'), shellSource);
      writeFileSync(join(outDir, 'robots.txt'), [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /profile',
        'Disallow: /settings',
        'Disallow: /reset-password',
        'Disallow: /api/',
        `Sitemap: ${siteUrl}/sitemap.xml`,
        '',
      ].join('\n'));
    },
  };
}
