// Shared utility: search for an article URL using Brave Search

export async function searchArticleUrl(headline, outlet) {
  try {
    const query = `${headline} ${outlet || ''}`.trim();
    const encoded = encodeURIComponent(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://search.brave.com/search?q=${encoded}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
      }
    );
    clearTimeout(timeout);
    const html = await res.text();

    // Extract external links — skip Brave's own domains and image CDNs
    const skipDomains = /search\.brave\.com|brave\.com|imgs\.search\.brave|tiles\.search\.brave|cdn\.search\.brave/;
    const linkMatches = [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)];
    for (const m of linkMatches) {
      const url = m[1];
      if (skipDomains.test(url)) continue;
      if (/\.(png|jpg|jpeg|gif|svg|ico|css|js)(\?|$)/i.test(url)) continue;
      // Return the first real result URL
      return url;
    }
  } catch (e) {
    console.log(`URL search failed for "${headline}": ${e.message}`);
  }
  return null;
}
