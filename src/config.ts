// Plain-text form: used in <title>, meta tags, OG/Twitter cards, the web
// manifest, and anywhere middots would be unsafe or just noise (feeds,
// share-card renderers). The dotted display wordmark (10·08·2026) is styled
// separately where the site name renders visually — see Base.astro.
export const SITE_NAME = "10.08.2026";
// Keep in sync with `site` in astro.config.mjs — this drives absolute OG image
// and canonical URLs. 10082026.com is the permanent domain (see `routes` in
// wrangler.jsonc).
export const SITE_URL = "https://10082026.com";
// Media (compressed video/thumbnails) is currently served site-relative from
// public/media/ — this fork's R2 bucket (`redsoil-media`, to be bound to
// media.10082026.com) does not exist yet. Once it does, push public/media/*
// to the bucket and flip this one constant to "https://media.10082026.com/";
// all media paths in videos.json are relative to it by design.
export const MEDIA_BASE = "/media/";
// No contact email constant by design. Corrections and takedowns go through
// the form at /takedown/, which posts to a Worker and stores requests in D1 —
// so the maintainer's personal address is never published on a public page.
