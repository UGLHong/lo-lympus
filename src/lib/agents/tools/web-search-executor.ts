export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchResponse = {
  results: WebSearchResult[];
  error?: string;
};

async function searchWithGoogle(query: string, limit: number): Promise<WebSearchResult[]> {
  try {
    const response = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const results: WebSearchResult[] = [];

    const resultPattern =
      /<a\s+href="([^"]*)"[^>]*>([^<]+)<\/a>.*?<div[^>]*>([^<]+)<\/div>/gi;
    let match;
    let count = 0;

    while ((match = resultPattern.exec(html)) && count < limit) {
      const url = match[1];
      const title = match[2];
      const snippet = match[3];

      if (url && title && !url.startsWith('/')) {
        results.push({ title, url, snippet: snippet.substring(0, 200) });
        count++;
      }
    }

    return results;
  } catch {
    return [];
  }
}

async function searchWithSerpAPI(query: string, limit: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(
      `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=${limit}`,
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      organic_results?: Array<{ title: string; link: string; snippet: string }>;
    };
    return (
      data.organic_results?.map((r) => ({
        title: r.title,
        url: r.link,
        snippet: r.snippet,
      })) || []
    );
  } catch {
    return [];
  }
}

async function searchWithTavily(query: string, limit: number): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: limit,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      results?: Array<{ title: string; url: string; content: string }>;
    };
    return (
      data.results?.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content.substring(0, 300),
      })) || []
    );
  } catch {
    return [];
  }
}

export async function executeWebSearch(query: string, limit: number = 3): Promise<WebSearchResponse> {
  if (!query || query.trim().length === 0) {
    return { results: [], error: 'Query is required' };
  }

  const cleanLimit = Math.max(1, Math.min(5, limit));

  try {
    let results: WebSearchResult[] = [];

    if (process.env.TAVILY_API_KEY) {
      results = await searchWithTavily(query, cleanLimit);
    } else if (process.env.SERPAPI_API_KEY) {
      results = await searchWithSerpAPI(query, cleanLimit);
    } else {
      results = await searchWithGoogle(query, cleanLimit);
    }

    return {
      results: results.slice(0, cleanLimit),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      results: [],
      error: `Web search failed: ${message}`,
    };
  }
}
