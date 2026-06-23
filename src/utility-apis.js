"use strict";

/**
 * utility-apis.js — 20+ Free Utility API Functions
 *
 * All functions are stateless HTTP calls — zero CPU overhead.
 * Most APIs require NO API key.
 */

const https = require("node:https");
const http = require("node:http");

// =============================================
// HELPER — Generic HTTPS GET (JSON) with redirect following
// =============================================
function httpGet(url, headers = {}, timeout = 10000, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    function doGet(currentUrl, redirectsLeft) {
      const parsedUrl = new URL(currentUrl);
      const client = parsedUrl.protocol === "https:" ? https : http;
      const req = client.get(currentUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
          ...headers
        }
      }, (res) => {
        // Follow redirects (301, 302, 307, 308)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const newUrl = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, currentUrl).href;
          res.resume(); // consume response
          return doGet(newUrl, redirectsLeft - 1);
        }
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(timeout, () => { req.destroy(); reject(new Error("HTTP timeout")); });
    }
    doGet(url, maxRedirects);
  });
}

function httpPost(url, body, headers = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === "https:" ? https : http;
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = client.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Content-Length": Buffer.byteLength(payload),
        ...headers
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error("HTTP timeout")); });
    req.write(payload);
    req.end();
  });
}



// =============================================
// 2. NEWS — NewsAPI (free, 100/day)
// =============================================
async function getNews(topic) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return { error: "NEWS_API_KEY not set. Get free: https://newsapi.org/" };

  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&pageSize=5&apiKey=${apiKey}`;
    const res = await httpGet(url);
    if (!res.data.articles || res.data.articles.length === 0) {
      return { text: `📰 "${topic}" ke baare me koi news nahi mili.` };
    }
    const articles = res.data.articles.slice(0, 5);
    const text = `📰 **Top News: ${topic}**\n\n` + articles.map((a, i) =>
      `${i + 1}. **${a.title}**\n   ${a.description || ""}\n   🔗 ${a.url}\n   📅 ${new Date(a.publishedAt).toLocaleDateString("en-IN")}`
    ).join("\n\n");
    return { text };
  } catch (err) {
    return { error: "News fetch failed: " + err.message };
  }
}

// =============================================
// 3. JOKES — JokeAPI (FREE, NO KEY)
// =============================================
async function getJoke(category) {
  try {
    const cat = category || "Any";
    const url = `https://v2.jokeapi.dev/joke/${cat}?lang=en&type=twopart,single`;
    const res = await httpGet(url);
    const d = res.data;
    if (d.error) return { text: "😅 Joke nahi mila, dobara try kar!" };

    if (d.type === "twopart") {
      return { text: `😂 **Joke:**\n\n${d.setup}\n\n> ${d.delivery}` };
    } else {
      return { text: `😂 **Joke:**\n\n${d.joke}` };
    }
  } catch (err) {
    return { error: "Joke fetch failed: " + err.message };
  }
}

// =============================================
// 4. QUOTES — Quotable API (FREE, NO KEY)
// =============================================
async function getQuote(tag) {
  // Try type.fit Quotes API (reliable, no SSL issues)
  try {
    const url = "https://type.fit/api/quotes";
    const res = await httpGet(url, {}, 5000);
    if (Array.isArray(res.data) && res.data.length > 0) {
      const q = res.data[Math.floor(Math.random() * res.data.length)];
      return {
        text: `📜 **Quote:**\n\n> "${q.text}"\n\n— **${q.author || "Unknown"}**`
      };
    }
  } catch (_) {}

  // Fallback: API Ninjas Quotes
  try {
    const url = `https://api.api-ninjas.com/v1/quotes${tag ? `?category=${tag}` : ""}`;
    const res = await httpGet(url, { "X-Api-Key": "free" }, 5000);
    const q = Array.isArray(res.data) ? res.data[0] : null;
    if (q && q.quote) {
      return {
        text: `📜 **Quote:**\n\n> "${q.quote}"\n\n— **${q.author || "Unknown"}**\n🏷️ ${q.category || ""}`
      };
    }
  } catch (_) {}

  return { text: "📜 Quote service down hai. Thodi der baad try kar!" };
}

// =============================================
// 5. TRIVIA — Open Trivia DB (FREE, NO KEY)
// =============================================
async function getTrivia(difficulty) {
  try {
    const diff = difficulty || "medium";
    const url = `https://opentdb.com/api.php?amount=1&difficulty=${diff}&type=multiple`;
    const res = await httpGet(url);
    const q = res.data?.results?.[0];
    if (!q) return { text: "🧠 Trivia nahi mila!" };

    // Decode HTML entities
    const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const allAnswers = [...q.incorrect_answers, q.correct_answer]
      .map(decode)
      .sort(() => Math.random() - 0.5);

    return {
      text: `🧠 **Trivia Question** (${q.difficulty})\n\n**Category:** ${decode(q.category)}\n\n**Q:** ${decode(q.question)}\n\n${allAnswers.map((a, i) => `  ${String.fromCharCode(65 + i)}) ${a}`).join("\n")}\n\n||**Answer:** ${decode(q.correct_answer)}||`,
      answer: decode(q.correct_answer)
    };
  } catch (err) {
    return { error: "Trivia fetch failed: " + err.message };
  }
}

// =============================================
// 6. DICTIONARY — Free Dictionary API (FREE, NO KEY)
// =============================================
async function getDictionary(word) {
  try {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    const res = await httpGet(url);
    if (res.status !== 200 || !Array.isArray(res.data)) {
      return { text: `📖 "${word}" ka meaning nahi mila.` };
    }
    const entry = res.data[0];
    const meanings = entry.meanings?.slice(0, 3) || [];
    let text = `📖 **${entry.word}**`;
    if (entry.phonetic) text += ` (${entry.phonetic})`;
    text += "\n\n";

    for (const m of meanings) {
      text += `**${m.partOfSpeech}:**\n`;
      const defs = m.definitions?.slice(0, 2) || [];
      for (const d of defs) {
        text += `• ${d.definition}\n`;
        if (d.example) text += `  _Example: "${d.example}"_\n`;
      }
      text += "\n";
    }
    return { text: text.trim() };
  } catch (err) {
    return { error: "Dictionary fetch failed: " + err.message };
  }
}

// =============================================
// 7. COUNTRY DATA — REST Countries (FREE, NO KEY)
// =============================================
async function getCountryInfo(country) {
  try {
    // Try exact name first, then fuzzy search
    let res = await httpGet(`https://restcountries.com/v3.1/name/${encodeURIComponent(country.trim())}?fields=name,capital,population,region,subregion,languages,currencies,flags,timezones`);
    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) {
      // Try partial/fuzzy match
      res = await httpGet(`https://restcountries.com/v3.1/name/${encodeURIComponent(country.trim())}`);
    }
    if (res.status !== 200 || !Array.isArray(res.data) || res.data.length === 0) {
      return { text: `🌍 "${country}" ke baare me info nahi mili. Full country name try karo (e.g., India, Japan, Brazil).` };
    }
    const c = res.data[0];
    const langs = c.languages ? Object.values(c.languages).join(", ") : "N/A";
    const curr = c.currencies ? Object.values(c.currencies).map(v => `${v.name} (${v.symbol})`).join(", ") : "N/A";
    return {
      text: `🌍 **${c.name?.common || country}** (${c.name?.official || ""})\n\n🏛️ Capital: **${c.capital?.[0] || "N/A"}**\n👥 Population: **${(c.population || 0).toLocaleString()}**\n🌏 Region: ${c.region || "N/A"} → ${c.subregion || ""}\n🗣️ Languages: ${langs}\n💰 Currency: ${curr}\n🕐 Timezone: ${c.timezones?.[0] || "N/A"}\n🏳️ Flag: ${c.flags?.emoji || c.flags?.png || ""}`
    };
  } catch (err) {
    return { error: "Country info fetch failed: " + err.message };
  }
}

// =============================================


// =============================================
// 9. MOVIES / TV — TMDB (free, unlimited)
// =============================================
async function getMovie(title) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { error: "TMDB_API_KEY not set. Get free: https://www.themoviedb.org/settings/api" };

  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=en-US`;
    const res = await httpGet(url);
    const movie = res.data?.results?.[0];
    if (!movie) return { text: `🎬 "${title}" movie nahi mili.` };

    return {
      text: `🎬 **${movie.title}** ${movie.original_title !== movie.title ? `(${movie.original_title})` : ""}\n\n⭐ Rating: **${movie.vote_average}/10** (${movie.vote_count} votes)\n📅 Release: ${movie.release_date || "N/A"}\n📝 Overview: ${movie.overview || "No description."}\n🎭 Popularity: ${movie.popularity?.toFixed(0) || "N/A"}${movie.poster_path ? `\n🖼️ Poster: https://image.tmdb.org/t/p/w500${movie.poster_path}` : ""}`
    };
  } catch (err) {
    return { error: "Movie fetch failed: " + err.message };
  }
}

// =============================================
// 10. RECIPES — Spoonacular (free, 150/day)
// =============================================
async function getRecipe(dish) {
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) return { error: "SPOONACULAR_API_KEY not set. Get free: https://spoonacular.com/food-api" };

  try {
    const searchUrl = `https://api.spoonacular.com/recipes/complexSearch?query=${encodeURIComponent(dish)}&number=1&addRecipeInformation=true&apiKey=${apiKey}`;
    const res = await httpGet(searchUrl);
    const recipe = res.data?.results?.[0];
    if (!recipe) return { text: `🍳 "${dish}" ka recipe nahi mila.` };

    // Clean HTML from instructions
    const instructions = (recipe.summary || "").replace(/<[^>]*>/g, "").substring(0, 300);
    return {
      text: `🍳 **${recipe.title}**\n\n⏱️ Ready in: **${recipe.readyInMinutes || "?"} min**\n👥 Servings: ${recipe.servings || "?"}\n⭐ Score: ${recipe.spoonacularScore?.toFixed(0) || "N/A"}/100\n🥗 ${recipe.vegetarian ? "✅ Vegetarian" : "🍖 Non-Veg"} ${recipe.vegan ? "| ✅ Vegan" : ""}\n\n📝 ${instructions}...\n\n🔗 Full Recipe: ${recipe.sourceUrl || recipe.spoonacularSourceUrl || ""}`
    };
  } catch (err) {
    return { error: "Recipe fetch failed: " + err.message };
  }
}

// =============================================
// 11. STOCKS / CRYPTO — Yahoo Finance (FREE, NO KEY)
// =============================================
async function getStockPrice(symbol) {
  try {
    // Try crypto first (common queries like BTC, ETH)
    const cryptoMap = {
      "btc": "BTC-USD", "bitcoin": "BTC-USD",
      "eth": "ETH-USD", "ethereum": "ETH-USD",
      "doge": "DOGE-USD", "dogecoin": "DOGE-USD",
      "sol": "SOL-USD", "solana": "SOL-USD",
      "xrp": "XRP-USD", "ripple": "XRP-USD",
      "ada": "ADA-USD", "cardano": "ADA-USD",
      "bnb": "BNB-USD"
    };
    const ticker = cryptoMap[symbol.toLowerCase()] || symbol.toUpperCase();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await httpGet(url);
    const meta = res.data?.chart?.result?.[0]?.meta;
    if (!meta) return { text: `📊 "${symbol}" ka price nahi mila. Ticker symbol check karo (e.g., RELIANCE.NS, TCS.NS, BTC, AAPL).` };

    const price = meta.regularMarketPrice || 0;
    const prevClose = meta.chartPreviousClose || meta.previousClose || price;
    const change = price - prevClose;
    const changePct = prevClose ? ((change / prevClose) * 100).toFixed(2) : "0.00";
    const emoji = change >= 0 ? "📈" : "📉";
    const currency = meta.currency || "USD";

    return {
      text: `${emoji} **${meta.shortName || meta.symbol || ticker}** (${meta.symbol})\n\n💰 Price: **${currency} ${price.toLocaleString()}**\n${change >= 0 ? "🟢" : "🔴"} Change: ${change >= 0 ? "+" : ""}${change.toFixed(2)} (${changePct}%)\n📊 Market: ${meta.exchangeName || "N/A"}\n🕐 Updated: ${new Date((meta.regularMarketTime || 0) * 1000).toLocaleString("en-IN")}`
    };
  } catch (err) {
    return { error: "Stock/Crypto price fetch failed: " + err.message };
  }
}


// =============================================
// 13. BOOKS — Open Library (FREE, NO KEY)
// =============================================
async function getBook(title) {
  try {
    const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=1`;
    const res = await httpGet(url, {}, 8000);
    const book = res.data?.docs?.[0];
    if (!book) return { text: `📚 "${title}" book nahi mili.` };

    return {
      text: `📚 **${book.title}**\n\n✍️ Author: **${book.author_name?.[0] || "Unknown"}**\n📅 First Published: ${book.first_publish_year || "N/A"}\n📖 Pages: ${book.number_of_pages_median || "N/A"}\n🏷️ Subject: ${book.subject?.slice(0, 3).join(", ") || "N/A"}\n⭐ Editions: ${book.edition_count || "N/A"}\n🌐 Languages: ${book.language?.slice(0, 3).join(", ") || "N/A"}\n🔗 https://openlibrary.org${book.key || ""}`
    };
  } catch (err) {
    return { text: `📚 Open Library se response nahi aaya. Thodi der baad try karo.` };
  }
}

// =============================================
// 14. SPORTS SCORES — Free ESPN/Scoreboard
// =============================================
async function getSportsScore(sport, query) {
  try {
    // Use ESPN public API for live scores
    const sportMap = {
      "cricket": "cricket",
      "football": "soccer",
      "soccer": "soccer",
      "nba": "basketball",
      "basketball": "basketball",
      "tennis": "tennis",
      "ipl": "cricket"
    };
    const espnSport = sportMap[sport?.toLowerCase()] || "cricket";

    // Fallback to cricbuzz-like free API for cricket
    if (espnSport === "cricket") {
      const url = "https://api.cricapi.com/v1/currentMatches?apikey=demo&offset=0";
      const res = await httpGet(url);
      if (res.data?.data && res.data.data.length > 0) {
        const matches = res.data.data.slice(0, 3);
        let text = "🏏 **Live Cricket Scores**\n\n";
        for (const m of matches) {
          text += `• **${m.name || "Match"}**\n  ${m.status || "In Progress"}\n  ${m.score?.[0]?.r ? `Score: ${m.score[0].r}/${m.score[0].w} (${m.score[0].o} ov)` : ""}\n\n`;
        }
        return { text: text.trim() };
      }
    }

    return { text: `🏆 "${sport || "cricket"}" ke live scores abhi available nahi hain. Try "cricket score", "football score".` };
  } catch (err) {
    return { error: "Sports score fetch failed: " + err.message };
  }
}

module.exports = {
  getNews, getJoke, getQuote, getTrivia,
  getDictionary, getCountryInfo,
  getMovie, getRecipe, getStockPrice,
  getBook, getSportsScore
};
