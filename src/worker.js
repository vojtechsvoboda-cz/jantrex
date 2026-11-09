// JANTREX podklady: statické soubory + odpovědi a nahrané soubory v KV.
//
// Formulář (bez hesla, odkaz dostane Honza):
//   GET    /api/podklady            -> rozpracované odpovědi (aby šlo pokračovat i z jiného zařízení)
//   POST   /api/podklady            -> uloží odpovědi; při odeslání navíc kopii "odeslano:<čas>"
//   POST   /api/soubor?name=&krok=  -> nahraje jeden soubor (tělo = binární data), vrátí {id}
//   DELETE /api/soubor?id=          -> smaže soubor, který Honza nahrál omylem
//
// Stránka /odpovedi (heslo = secret HESLO, posílá se v hlavičce x-heslo nebo ?k=):
//   GET    /api/odpovedi            -> aktuální stav + odeslané verze + seznam souborů
//   GET    /soubor/<id>?k=          -> stažení / náhled souboru
//
// Limity KV (zdarma): hodnota max 25 MB, 1 000 zápisů denně, 1 GB celkem.

const KEY = 'podklady:aktualni';
const MAX_FILE = 24 * 1024 * 1024;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const newId = () => {
  const t = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return t + '-' + crypto.randomUUID().slice(0, 8);
};

const cleanName = (s) =>
  String(s || 'soubor').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 140) || 'soubor';

function authed(request, env, url) {
  if (!env.HESLO) return false;
  const given = request.headers.get('x-heslo') || url.searchParams.get('k') || '';
  return given === env.HESLO;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    const m = request.method;

    // ---------- odpovědi z formuláře ----------
    if (p === '/api/podklady') {
      if (m === 'GET') {
        const data = await env.PODKLADY.get(KEY);
        return new Response(data || '{}', {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      if (m !== 'POST') return json({ ok: false, error: 'method' }, 405);
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'json' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'body' }, 400);
      const now = new Date().toISOString();
      const justSent = !!body.justSent;
      delete body.justSent;
      const record = JSON.stringify({ ...body, savedAt: now });
      if (record.length > 200000) return json({ ok: false, error: 'size' }, 413);
      await env.PODKLADY.put(KEY, record);
      if (justSent) await env.PODKLADY.put(`odeslano:${now}`, record);
      return json({ ok: true, savedAt: now });
    }

    // ---------- nahrání / smazání souboru ----------
    if (p === '/api/soubor') {
      if (m === 'POST') {
        const len = +(request.headers.get('content-length') || 0);
        if (len > MAX_FILE) return json({ ok: false, error: 'Soubor je větší než 24 MB.' }, 413);
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) return json({ ok: false, error: 'Prázdný soubor.' }, 400);
        if (buf.byteLength > MAX_FILE) return json({ ok: false, error: 'Soubor je větší než 24 MB.' }, 413);
        const id = newId();
        const meta = {
          name: cleanName(url.searchParams.get('name')),
          krok: String(url.searchParams.get('krok') || '').slice(0, 40),
          type: (request.headers.get('content-type') || 'application/octet-stream').slice(0, 100),
          size: buf.byteLength,
          at: new Date().toISOString(),
        };
        await env.PODKLADY.put(`soubor:${id}`, buf, { metadata: meta });
        return json({ ok: true, id, ...meta });
      }
      if (m === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        if (!/^[\w-]{10,40}$/.test(id)) return json({ ok: false }, 400);
        await env.PODKLADY.delete(`soubor:${id}`);
        return json({ ok: true });
      }
      return json({ ok: false, error: 'method' }, 405);
    }

    // ---------- přehled pro Vojtu ----------
    if (p === '/api/odpovedi') {
      if (!env.HESLO) return json({ ok: false, error: 'Na Cloudflare chybí secret HESLO.' }, 503);
      if (!authed(request, env, url)) return json({ ok: false, error: 'heslo' }, 401);
      const current = JSON.parse((await env.PODKLADY.get(KEY)) || '{}');
      const sent = [];
      const sl = await env.PODKLADY.list({ prefix: 'odeslano:' });
      for (const k of sl.keys) {
        const v = await env.PODKLADY.get(k.name);
        if (v) sent.push({ at: k.name.slice(9), data: JSON.parse(v) });
      }
      sent.sort((a, b) => (a.at < b.at ? 1 : -1));
      const files = [];
      let cursor;
      do {
        const fl = await env.PODKLADY.list({ prefix: 'soubor:', cursor });
        for (const k of fl.keys) files.push({ id: k.name.slice(7), ...(k.metadata || {}) });
        cursor = fl.list_complete ? null : fl.cursor;
      } while (cursor);
      files.sort((a, b) => (a.at < b.at ? 1 : -1));
      return json({ ok: true, current, sent, files });
    }

    if (p.startsWith('/soubor/')) {
      if (!authed(request, env, url)) return new Response('Bez hesla to nepůjde.', { status: 401 });
      const id = p.slice(8);
      const { value, metadata } = await env.PODKLADY.getWithMetadata(`soubor:${id}`, { type: 'stream' });
      if (!value) return new Response('Soubor nenalezen.', { status: 404 });
      const md = metadata || {};
      const inline = /^(image|audio|video)\/|pdf/.test(md.type || '') && !url.searchParams.has('stahnout');
      return new Response(value, {
        headers: {
          'content-type': md.type || 'application/octet-stream',
          'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(md.name || id)}`,
          'cache-control': 'private, max-age=3600',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
