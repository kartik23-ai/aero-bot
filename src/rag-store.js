const fs = require('fs');
const path = require('path');
const axios = require('axios');

class RAGStore {
  constructor(filePath = 'db/rag_memory.json') {
    this.filePath = filePath;
    this.db = {};
    this.load();
  }

  load() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.filePath)) {
        this.db = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch (err) {
      console.error("[RAGStore] Failed to load db:", err.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.db, null, 2));
    } catch (err) {
      console.error("[RAGStore] Failed to save db:", err.message);
    }
  }

  async getEmbedding(text) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("[RAGStore] GEMINI_API_KEY not configured in environment.");
      return null;
    }
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`,
        {
          content: {
            parts: [{ text: text }]
          }
        },
        { timeout: 8000 }
      );
      return res.data?.embedding?.values || null;
    } catch (err) {
      console.error("[RAGStore] Embedding generation failed:", err.message);
      return null;
    }
  }

  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async addMemory(memoryKey, userText, assistantText) {
    const textToEmbed = `User: ${userText}\nAssistant: ${assistantText}`;
    const embedding = await this.getEmbedding(userText);
    if (!embedding) return;

    if (!this.db[memoryKey]) this.db[memoryKey] = [];
    this.db[memoryKey].push({
      text: textToEmbed,
      embedding,
      timestamp: Date.now()
    });

    // Keep up to 200 memories per user to manage storage size
    if (this.db[memoryKey].length > 200) {
      this.db[memoryKey].shift();
    }
    this.save();
  }

  async retrieveMemories(memoryKey, queryText, limit = 3) {
    if (!this.db[memoryKey] || this.db[memoryKey].length === 0) return [];
    const queryEmbedding = await this.getEmbedding(queryText);
    if (!queryEmbedding) return [];

    const scored = this.db[memoryKey].map(mem => {
      const score = this.cosineSimilarity(queryEmbedding, mem.embedding);
      return { text: mem.text, score, timestamp: mem.timestamp };
    });

    // Sort by similarity score descending
    scored.sort((a, b) => b.score - a.score);

    // Filter by threshold (0.65) and return top limit
    return scored
      .filter(s => s.score > 0.65)
      .slice(0, limit)
      .map(s => s.text);
  }

  retrieveRecentMemories(memoryKey, maxAgeMs = 12 * 60 * 60 * 1000, limit = 3) {
    if (!this.db[memoryKey] || this.db[memoryKey].length === 0) return [];
    const now = Date.now();
    const recent = this.db[memoryKey]
      .filter(mem => (now - mem.timestamp) < maxAgeMs)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .map(mem => mem.text);
    return recent;
  }
}

module.exports = new RAGStore();

