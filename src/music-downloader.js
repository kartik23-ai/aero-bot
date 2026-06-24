"use strict";

const { exec } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

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
 * Singleton service to manage YouTube & SoundCloud Music downloads and searches.
 */
class YtMusicService {
  static get instance() {
    if (!this._instance) {
      this._instance = new YtMusicService();
    }
    return this._instance;
  }

  async downloadAudio(query) {
    const isAvailable = await checkSystemDependencies();
    if (!isAvailable) {
      console.warn("[YtMusicService] System dependencies (yt-dlp or ffmpeg) are missing. Using silent fallback.");
      return MOCK_SILENT_MP3;
    }

    // Enhance query accuracy if it is a simple song name without standard music suffixes
    let enhancedQuery = query.trim();
    if (!/(song|music|audio|video|lyrics|mp3|official|remix|dlp|cover)/i.test(enhancedQuery)) {
      enhancedQuery = `${enhancedQuery} song`;
      console.log(`[YtMusicService] Query enhanced to: "${enhancedQuery}" for better search accuracy`);
    }

    // List of sources to try sequentially
    const targets = [];

    // 1. YouTube Resolved Direct Watch URL
    const ytUrl = await this.searchYoutubeUrl(enhancedQuery);
    if (ytUrl) {
      targets.push({ url: ytUrl, name: "YouTube Direct URL" });
    }

    // 2. SoundCloud Resolved Direct URL (Alternative Source)
    const scUrl = await this.searchSoundCloudUrl(enhancedQuery);
    if (scUrl) {
      targets.push({ url: scUrl, name: "SoundCloud Direct URL" });
    }

    // 3. YouTube Search Query Fallback (Legacy search)
    targets.push({ url: `ytsearch1:${enhancedQuery}`, name: "YouTube Search Query" });

    // Iterate through download sources
    for (const target of targets) {
      try {
        console.log(`[YtMusicService] Attempting download using ${target.name}: "${target.url}"`);
        const audioUri = await this._executeDownload(target.url);
        if (audioUri) {
          console.log(`[YtMusicService] Successful download using: ${target.name}`);
          return audioUri;
        }
      } catch (err) {
        console.warn(`[YtMusicService] Download failed for ${target.name}:`, err.message);
      }
    }

    throw new Error("All download sources (YouTube Direct, SoundCloud, and YouTube Search) failed.");
  }

  _executeDownload(target) {
    return new Promise((resolve, reject) => {
      const tempDir = os.tmpdir();
      const tempFileId = "yt-" + Math.random().toString(36).substring(2, 10);
      const outputPathPattern = path.join(tempDir, `${tempFileId}.%(ext)s`);
      
      const cmd = `yt-dlp --no-check-certificates --extract-audio --audio-format mp3 --audio-quality 0 --max-filesize 15M -o "${outputPathPattern}" "${target}"`;
      console.log(`[YtMusicService] Executing: ${cmd}`);

      exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
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

  async searchSoundCloudUrl(query) {
    try {
      const { providers } = require("./providers");
      const searchQuery = `${query} site:soundcloud.com`;
      console.log(`[YtMusicService] Searching for SoundCloud URL: "${searchQuery}"`);
      const searchRes = await providers.webSearch(searchQuery);
      if (searchRes && searchRes.results && searchRes.results.length > 0) {
        const match = searchRes.results.find(r => r.url && r.url.includes("soundcloud.com/"));
        if (match) {
          console.log(`[YtMusicService] Found matching SoundCloud URL: ${match.url}`);
          return match.url;
        }
      }
    } catch (err) {
      console.warn(`[YtMusicService] Web search for SoundCloud URL failed:`, err.message);
    }
    return null;
  }
}

/**
 * Downloads a song from YouTube using YtMusicService.
 */
async function downloadYoutubeAudio(query) {
  return await YtMusicService.instance.downloadAudio(query);
}

module.exports = {
  downloadYoutubeAudio,
  YtMusicService
};
