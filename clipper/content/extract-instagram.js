// Nestbau Rezept-Clipper – Extraktor fuer Instagram.
//
// Instagram liefert kein schema.org/Recipe und die CSS-Klassen sind
// generiert und aendern sich staendig. Deshalb bewusst KEINE Klassen-
// Selektoren, sondern mehrere unabhaengige Strategien, deren beste (=
// laengste plausible Caption) gewinnt. Faellt eine weg, tragen die anderen.
//
// Der Rest ist Aufgabe des Servers: aus "3 Eier 🥚 200g Mehl #baking" ein
// strukturiertes Rezept zu machen, ist genau der KI-Teil.

(() => {
  const MAX_TEXT = 20000;

  function meta(...selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const value = el && el.getAttribute('content');
      if (value && value.trim()) return value.trim();
    }
    return '';
  }

  /** Caption-Kandidaten aus verschiedenen Quellen einsammeln. */
  function captionCandidates() {
    const out = [];

    // 1. og:description – funktioniert auch, wenn das DOM noch nicht fertig ist.
    //    Format: "1,234 likes, 56 comments - user on Datum: "<caption>""
    const description = meta('meta[property="og:description"]', 'meta[name="description"]');
    if (description) {
      const quoted = description.match(/[:\-]\s*["“]([\s\S]+)["”]\s*$/);
      out.push(quoted ? quoted[1] : description);
    }

    const article = document.querySelector('article') || document.body;
    if (!article) return out;

    // 2. h1 im Beitrag – dort steht bei Einzelbeitraegen die Caption.
    article.querySelectorAll('h1').forEach((el) => {
      const text = (el.innerText || '').trim();
      if (text.length > 40) out.push(text);
    });

    // 3. Laengster zusammenhaengender Textblock im Beitrag. Bei Rezepten ist
    //    das praktisch immer die Caption – Kommentare sind kuerzer.
    const blocks = [];
    article.querySelectorAll('span, div[dir="auto"], li').forEach((el) => {
      if (el.querySelector('span, div[dir="auto"]')) return;   // nur Blattknoten
      const text = (el.innerText || '').trim();
      if (text.length > 80 && text.length < MAX_TEXT) blocks.push(text);
    });
    blocks.sort((a, b) => b.length - a.length);
    out.push(...blocks.slice(0, 3));

    return out;
  }

  /** Sieht der Text nach einem Rezept aus? Entscheidet nur die Reihenfolge. */
  function recipeScore(text) {
    const lower = text.toLowerCase();
    const hints = ['zutaten', 'ingredients', 'zubereitung', 'rezept', 'recipe',
      'portionen', 'servings', 'backen', 'anleitung', 'method'];
    const unitHits = (text.match(/\b\d+\s*(g|kg|ml|dl|l|el|tl|stk|stück|cup|tbsp|tsp)\b/gi) || []).length;
    const lineCount = text.split('\n').filter((line) => line.trim().length > 2).length;
    return hints.filter((hint) => lower.includes(hint)).length * 3
      + Math.min(unitHits, 10)
      + Math.min(lineCount / 4, 5);
  }

  function bestCaption() {
    const seen = new Set();
    const candidates = captionCandidates()
      .map((text) => text.replace(/ /g, ' ').trim())
      .filter((text) => {
        if (!text || text.length < 30 || seen.has(text)) return false;
        seen.add(text);
        return true;
      })
      .map((text) => ({ text, score: recipeScore(text) + Math.min(text.length / 400, 3) }))
      .sort((a, b) => b.score - a.score);

    return candidates.length ? candidates[0].text.slice(0, MAX_TEXT) : '';
  }

  function bestImage() {
    const fromMeta = meta('meta[property="og:image"]');
    if (fromMeta) return fromMeta;

    const article = document.querySelector('article') || document.body;
    let best = null;
    let bestArea = 0;
    (article ? article.querySelectorAll('img') : []).forEach((img) => {
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      // Profilbilder sind quadratisch und klein – die will man hier nicht.
      if (width < 300 || height < 300) return;
      if (width * height <= bestArea) return;
      const src = img.currentSrc || img.src;
      if (!src || src.startsWith('data:')) return;
      best = src;
      bestArea = width * height;
    });
    return best;
  }

  function author() {
    const path = location.pathname.match(/^\/([A-Za-z0-9._]+)\/(p|reel|tv)\//);
    if (path) return path[1];
    const title = meta('meta[property="og:title"]');
    const parsed = title && title.match(/^([^(•|]+)/);
    return parsed ? parsed[1].trim().slice(0, 80) : null;
  }

  const caption = bestCaption();

  return {
    sourceType: 'instagram',
    url: location.href.split('?')[0],
    siteName: 'Instagram',
    title: caption ? caption.split('\n')[0].slice(0, 120) : (document.title || 'Instagram'),
    author: author(),
    text: caption,
    jsonLd: [],
    imageUrl: bestImage(),
    hasStructuredData: false,
    // Der Popup warnt, wenn hier nichts Brauchbares stand – dann ist meist
    // der Beitrag noch nicht fertig geladen oder es ist ein Karussell.
    captionFound: Boolean(caption)
  };
})();
