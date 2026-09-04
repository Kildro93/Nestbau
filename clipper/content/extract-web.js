// Nestbau Rezept-Clipper – Extraktor fuer normale Websites.
//
// Wird per chrome.scripting.executeScript in die aktive Seite injiziert und
// gibt sein Ergebnis als Rueckgabewert zurueck (kein Message-Passing noetig).
//
// Ziel ist NICHT, hier schon ein fertiges Rezept zu bauen. Ziel ist, dem
// Server moeglichst gutes Rohmaterial zu liefern: strukturierte Daten zuerst,
// Fliesstext als Fallback. Das eigentliche Parsen passiert serverseitig –
// sonst muesste die Extension bei jeder Website-Aenderung nachgepflegt werden.

(() => {
  const MAX_TEXT = 60000;

  function meta(...selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = el && (el.getAttribute('content') || el.getAttribute('href'));
      if (value && value.trim()) return value.trim();
    }
    return '';
  }

  function collectJsonLd() {
    const blocks = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      const text = (script.textContent || '').trim();
      if (text && text.length < 200000 && blocks.length < 8) blocks.push(text);
    });
    return blocks;
  }

  /**
   * Microdata-Fallback fuer Seiten ohne JSON-LD. Wird als synthetisches
   * schema.org-Objekt verpackt, damit der Server nur EINEN Pfad kennen muss.
   */
  function collectMicrodata() {
    const scope = document.querySelector('[itemtype*="schema.org/Recipe" i]');
    if (!scope) return null;

    const prop = (name) => {
      const el = scope.querySelector(`[itemprop="${name}"]`);
      if (!el) return '';
      return (el.getAttribute('content') || el.getAttribute('datetime') || el.textContent || '').trim();
    };
    const propAll = (name) => [...scope.querySelectorAll(`[itemprop="${name}"]`)]
      .map((el) => (el.getAttribute('content') || el.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 80);

    const ingredients = propAll('recipeIngredient').concat(propAll('ingredients'));
    if (!ingredients.length) return null;

    const image = scope.querySelector('[itemprop="image"]');
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: prop('name') || document.title,
      description: prop('description'),
      recipeYield: prop('recipeYield'),
      totalTime: prop('totalTime'),
      prepTime: prop('prepTime'),
      cookTime: prop('cookTime'),
      recipeCategory: prop('recipeCategory'),
      recipeIngredient: ingredients,
      recipeInstructions: propAll('recipeInstructions'),
      image: image ? (image.getAttribute('content') || image.src || '') : ''
    });
  }

  /** Den Container finden, in dem das Rezept wirklich steht. */
  function mainText() {
    const candidates = [
      '[itemtype*="schema.org/Recipe" i]',
      'article',
      '[role="main"]',
      'main',
      '.recipe, .rezept, #recipe, #rezept',
      '.entry-content, .post-content, .article-body'
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      const text = el && el.innerText ? el.innerText.trim() : '';
      // Unter ~300 Zeichen ist es eher eine Teaser-Box als das Rezept.
      if (text.length > 300) return text.slice(0, MAX_TEXT);
    }

    const body = document.body ? document.body.innerText || '' : '';
    return body.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_TEXT);
  }

  /** Grosses, plausibles Bild suchen – Logos und Icons ausschliessen. */
  function bestImage() {
    const fromMeta = meta('meta[property="og:image"]', 'meta[name="twitter:image"]', 'link[rel="image_src"]');
    if (fromMeta) return new URL(fromMeta, location.href).toString();

    const scope = document.querySelector('[itemtype*="schema.org/Recipe" i]')
      || document.querySelector('article')
      || document.body;
    if (!scope) return null;

    let best = null;
    let bestArea = 0;
    scope.querySelectorAll('img').forEach((img) => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      const area = width * height;
      if (width < 200 || height < 150 || area <= bestArea) return;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) return;
      best = src;
      bestArea = area;
    });
    return best ? new URL(best, location.href).toString() : null;
  }

  const microdata = collectMicrodata();
  const jsonLd = collectJsonLd();
  if (microdata) jsonLd.push(microdata);

  const selection = String(window.getSelection ? window.getSelection().toString() : '').trim();

  return {
    sourceType: 'web',
    url: location.href,
    siteName: meta('meta[property="og:site_name"]') || location.hostname,
    title: meta('meta[property="og:title"]') || document.title || '',
    author: meta('meta[name="author"]', 'meta[property="article:author"]') || null,
    // Eine aktive Textmarkierung schlaegt die Heuristik – der Nutzer weiss
    // besser als jeder Selektor, wo das Rezept steht.
    text: selection.length > 120 ? selection.slice(0, MAX_TEXT) : mainText(),
    jsonLd,
    imageUrl: bestImage(),
    hasStructuredData: jsonLd.length > 0
  };
})();
