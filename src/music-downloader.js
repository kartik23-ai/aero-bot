"use strict";

const { exec } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const axios = require("axios");

// 1-second silent MP3 base64 fallback for local development without yt-dlp/ffmpeg
const MOCK_SILENT_MP3 = "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//sQxAAs8AAA0gAAAAAANVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

/**
 * Checks if yt-dlp and ffmpeg are available on the system.
 */
function checkSystemDependencies() {
  return new Promise((resolve) => {
    exec("yt-dlp --version", (err1) => {
      if (err1) return resolve(false);
      exec("ffmpeg -version", (err2) => {
        if (err2) return resolve(false);
        resolve(true);
      });
    });
  });
}

/**
 * Singleton service to manage YouTube & JioSaavn Music downloads and searches.
 */
class YtMusicService {
  static get instance() {
    if (!this._instance) {
      this._instance = new YtMusicService();
    }
    return this._instance;
  }

  async searchJioSaavnUrl(query) {
    try {
      const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(query)}&_format=json&_marker=0&ctx=web6dot0&api_version=4`;
      console.log(`[YtMusicService] Searching JioSaavn for: "${query}"`);
      const res = await axios.get(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        },
        timeout: 10000
      });
      const results = res.data.results || [];
      if (results.length > 0) {
        const song = results[0];
        const encryptedUrl = song.more_info?.encrypted_media_url;
        if (encryptedUrl) {
          const authUrl = `https://www.jiosaavn.com/api.php?__call=song.generateAuthToken&url=${encodeURIComponent(encryptedUrl)}&bitrate=320&api_version=4&_format=json&ctx=web6dot0`;
          const authRes = await axios.get(authUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "application/json"
            },
            timeout: 10000
          });
          const downloadUrl = authRes.data.auth_url;
          if (downloadUrl) {
            console.log(`[YtMusicService] Found JioSaavn download URL for song: "${song.title || song.song}"`);
            return {
              url: downloadUrl,
              title: song.title || song.song,
              artist: song.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || ""
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[YtMusicService] JioSaavn search/resolve failed:`, err.message);
    }
    return null;
  }

  /**
   * Downloads JioSaavn CDN URL directly via axios (no yt-dlp needed).
   * JioSaavn returns a direct MP4/MP3 CDN stream — just download it as binary.
   */
  async _downloadJioSaavnDirect(cdnUrl, filename) {
    console.log(`[YtMusicService] Downloading JioSaavn CDN URL directly via axios...`);
    const response = await axios.get(cdnUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.jiosaavn.com/",
        "Accept": "*/*"
      },
      maxContentLength: 20 * 1024 * 1024 // 20MB max
    });

    const buffer = Buffer.from(response.data);
    if (buffer.length < 1000) {
      throw new Error(`JioSaavn direct download returned too-small buffer (${buffer.length} bytes). Possibly 403 or redirect.`);
    }

    console.log(`[YtMusicService] JioSaavn direct download success: ${buffer.length} bytes`);
    const base64Data = buffer.toString("base64");
    // JioSaavn returns MP4 container but it's actually AAC audio — treat as mp3 for compatibility
    return `data:audio/mp3;base64,${base64Data}`;
  }

  async downloadAudio(query) {
    // Enhance query accuracy if it is a simple song name without standard music suffixes
    let enhancedQuery = query.trim();
    if (!/(song|music|audio|video|lyrics|mp3|official|remix|dlp|cover)/i.test(enhancedQuery)) {
      enhancedQuery = `${enhancedQuery} song`;
      console.log(`[YtMusicService] Query enhanced to: "${enhancedQuery}" for better search accuracy`);
    }

    let resolvedFilename = `${query.trim()}.mp3`;

    // ── STEP 1: Try JioSaavn with direct axios download (no yt-dlp) ──
    const saavnData = await this.searchJioSaavnUrl(query);
    if (saavnData) {
      resolvedFilename = `${saavnData.title} - ${saavnData.artist}.mp3`.replace(/[^a-zA-Z0-9_\-\s\.]/g, "");
      try {
        const audioUri = await this._downloadJioSaavnDirect(saavnData.url, resolvedFilename);
        console.log(`[YtMusicService] ✅ JioSaavn direct download succeeded!`);
        return { uri: audioUri, filename: resolvedFilename };
      } catch (saavnErr) {
        console.warn(`[YtMusicService] JioSaavn direct download failed: ${saavnErr.message}. Falling back to yt-dlp...`);
      }
    }

    // ── STEP 2: Try yt-dlp for YouTube (if available) ──
    const isAvailable = await checkSystemDependencies();
    if (!isAvailable) {
      console.warn("[YtMusicService] yt-dlp/ffmpeg not available. Returning silent fallback.");
      return { uri: MOCK_SILENT_MP3, filename: "silent.mp3" };
    }

    // Try YouTube direct URL first, then search
    const ytUrl = await this.searchYoutubeUrl(enhancedQuery);
    const ytTargets = [];
    if (ytUrl) {
      ytTargets.push({ url: ytUrl, name: "YouTube Direct URL" });
    }
    ytTargets.push({ url: `ytsearch1:${enhancedQuery}`, name: "YouTube Search Query" });

    for (const target of ytTargets) {
      try {
        console.log(`[YtMusicService] Attempting yt-dlp download: ${target.name}: "${target.url}"`);
        const audioUri = await this._executeYtDlp(target.url);
        if (audioUri) {
          console.log(`[YtMusicService] ✅ yt-dlp download succeeded: ${target.name}`);
          return { uri: audioUri, filename: resolvedFilename };
        }
      } catch (err) {
        console.warn(`[YtMusicService] yt-dlp failed for ${target.name}:`, err.message);
      }
    }

    throw new Error("All download sources (JioSaavn direct + YouTube yt-dlp) failed.");
  }

  _executeYtDlp(target) {
    return new Promise((resolve, reject) => {
      const tempDir = os.tmpdir();
      const tempFileId = "yt-" + Math.random().toString(36).substring(2, 10);
      const outputPathPattern = path.join(tempDir, `${tempFileId}.%(ext)s`);
      
      const cmd = `yt-dlp --no-check-certificates --impersonate chrome --retries 0 --fragment-retries 0 --socket-timeout 8 --extract-audio --audio-format mp3 --audio-quality 0 --max-filesize 15M -o "${outputPathPattern}" "${target}"`;
      console.log(`[YtMusicService] Executing: ${cmd}`);

      exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          console.error("[YtMusicService] Exec error:", error.message);
          return reject(new Error("Failed to download audio: " + error.message));
        }

        const expectedFilePath = path.join(tempDir, `${tempFileId}.mp3`);
        if (fs.existsSync(expectedFilePath)) {
          try {
            console.log(`[YtMusicService] Successfully downloaded: ${expectedFilePath}`);
            const fileBuffer = fs.readFileSync(expectedFilePath);
            const base64Data = fileBuffer.toString("base64");
            const audioUri = `data:audio/mp3;base64,${base64Data}`;
            
            fs.unlink(expectedFilePath, (unlinkErr) => {
              if (unlinkErr) console.error("[YtMusicService] Failed to delete temp file:", unlinkErr.message);
            });

            resolve(audioUri);
          } catch (readErr) {
            reject(new Error("Failed to read converted audio file: " + readErr.message));
          }
        } else {
          // Fallback search in directory
          fs.readdir(tempDir, (readDirErr, files) => {
            if (readDirErr) return reject(new Error("MP3 output file not found."));
            const match = files.find(f => f.startsWith(tempFileId) && f.endsWith(".mp3"));
            if (match) {
              const matchPath = path.join(tempDir, match);
              try {
                const fileBuffer = fs.readFileSync(matchPath);
                const base64Data = fileBuffer.toString("base64");
                const audioUri = `data:audio/mp3;base64,${base64Data}`;
                fs.unlink(matchPath, () => {});
                resolve(audioUri);
              } catch (err) {
                reject(err);
              }
            } else {
              reject(new Error("Audio conversion output file was not generated."));
            }
          });
        }
      });
    });
  }

  async searchYoutubeUrl(query) {
    try {
      const { providers } = require("./providers");
      const searchQuery = `${query} site:youtube.com/watch`;
      console.log(`[YtMusicService] Searching for YouTube video URL: "${searchQuery}"`);
      const searchRes = await providers.webSearch(searchQuery);
      if (searchRes && searchRes.results && searchRes.results.length > 0) {
        const match = searchRes.results.find(r => r.url && (r.url.includes("youtube.com/watch") || r.url.includes("youtu.be/")));
        if (match) {
          console.log(`[YtMusicService] Found matching YouTube URL: ${match.url}`);
          return match.url;
        }
      }
    } catch (err) {
      console.warn(`[YtMusicService] Web search for YouTube URL failed:`, err.message);
    }
    return null;
  }

}

/**
 * Downloads a song from JioSaavn (primary) or YouTube (fallback) using YtMusicService.
 */
async function downloadYoutubeAudio(query) {
  return await YtMusicService.instance.downloadAudio(query);
}

module.exports = {
  downloadYoutubeAudio,
  YtMusicService
};
