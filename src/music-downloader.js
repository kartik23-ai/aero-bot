"use strict";

const { exec, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const axios = require("axios");

// 1-second silent MP3 base64 fallback for local development without ffmpeg
const MOCK_SILENT_MP3 = "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//sQxAAs8AAA0gAAAAAANVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

/**
 * Checks if ffmpeg is available on the system.
 */
function checkFfmpeg() {
  return new Promise((resolve) => {
    const bin = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    execFile(bin, ["-version"], (err) => resolve(!err));
  });
}

/**
 * Decrypts JioSaavn's encrypted media URL using DES-ECB and the static key.
 */
function decryptUrl(encryptedUrl) {
  try {
    const key = Buffer.from("38346591", "utf8");
    const decipher = crypto.createDecipheriv("des-ecb", key, null);
    let decrypted = decipher.update(encryptedUrl, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted.trim();
  } catch (err) {
    console.error(`[YtMusicService] Decryption failed: ${err.message}. Ensure --openssl-legacy-provider flag is set.`);
    return null;
  }
}

/**
 * Singleton service to manage JioSaavn Music downloads.
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
      const queryLower = query.toLowerCase().replace(/[^a-z0-9\s]/g, "");
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2); // Keywords only
      const cleanQueryWords = queryLower.split(/\s+/).filter(w => w.length > 0);

      for (const song of results) {
        const title = song.title || song.song || "";
        const titleLower = title.toLowerCase();
        const artist = song.more_info?.artistMap?.primary_artists?.map(a => a.name).join(", ") || "";
        const artistLower = artist.toLowerCase();
        const playCount = Number(song.play_count) || 0;

        // 1. Check for instrumentals/bgm/ringtone
        const isInstrumental = song.more_info?.is_instrumental === "true" || 
          /\b(instrumental|karaoke|bgm|piano|flute|violin|ringtone|tribute|guitar|synthesizer|orchestra|beat)\b/i.test(titleLower);
        const userWantsInstrumental = /\b(instrumental|karaoke|bgm|piano|flute|violin|tribute)\b/i.test(queryLower);
        if (isInstrumental && !userWantsInstrumental) {
          console.log(`[YtMusicService] Skipping instrumental JioSaavn result: "${title}"`);
          continue;
        }

        // 2. Check for lofi/reverb/slowed/cover
        const isLofi = /\b(lofi|slowed|reverb|cover|remix|mashup|reply|female)\b/i.test(titleLower);
        const userWantsLofi = /\b(lofi|slowed|reverb|cover|remix|mashup|reply|female)\b/i.test(queryLower);
        if (isLofi && !userWantsLofi) {
          console.log(`[YtMusicService] Skipping lofi/reverb/cover JioSaavn result: "${title}"`);
          continue;
        }

        // 3. Cover Artist blacklist
        const isCoverArtist = /\b(cover|tribute|lofi|slowed|reverb|reply|recreated|swapnil|choudhary|sonu|nainsy|ajima|tuneit|dj)\b/i.test(artistLower);
        const userWantsCoverArtist = /\b(swapnil|choudhary|sonu|nainsy|ajima|tuneit)\b/i.test(queryLower);
        if (isCoverArtist && !userWantsCoverArtist && !userWantsLofi) {
          console.log(`[YtMusicService] Skipping cover artist JioSaavn result: "${title}" by "${artist}"`);
          continue;
        }

        // Removed extra unrequested words check to prevent false-skips


        // 5. Relevance check: verify that all significant query words are present in title or artist
        let isRelevant = true;
        for (const word of queryWords) {
          if (["song", "mp3", "music", "audio", "download", "official", "video"].includes(word)) continue;
          
          if (!titleLower.includes(word) && !artistLower.includes(word)) {
            // Check for spelling differences (kahan vs kahaan)
            if (word === "kahan" && (titleLower.includes("kahaan") || artistLower.includes("kahaan"))) continue;
            if (word === "kahaan" && (titleLower.includes("kahan") || artistLower.includes("kahan"))) continue;
            
            isRelevant = false;
            break;
          }
        }
        if (!isRelevant) {
          console.log(`[YtMusicService] Skipping irrelevant JioSaavn result: "${title}" by "${artist}"`);
          continue;
        }

        // Removed play count check to avoid false-skips


        const encryptedUrl = song.more_info?.encrypted_media_url;
        if (encryptedUrl) {
          const decryptedUrl = decryptUrl(encryptedUrl);
          if (decryptedUrl) {
            let finalUrl = decryptedUrl;
            if (finalUrl.includes("_96.mp4")) {
              finalUrl = finalUrl.replace("_96.mp4", "_160.mp4");
            } else if (finalUrl.includes("_48.mp4")) {
              finalUrl = finalUrl.replace("_48.mp4", "_160.mp4");
            }
            console.log(`[YtMusicService] Selected JioSaavn result: "${title}" by "${artist}"`);
            return { url: finalUrl, title, artist };
          }
        }
      }
    } catch (err) {
      console.warn(`[YtMusicService] JioSaavn search/resolve failed:`, err.message);
    }
    return null;
  }

  /**
   * Downloads JioSaavn CDN URL via Axios stream and compresses to 96kbps MP3 via ffmpeg.
   */
  async _downloadAndCompress(cdnUrl, filename) {
    const tempDir = os.tmpdir();
    const fileId = "saavn-" + Math.random().toString(36).substring(2, 10);
    const rawFile = path.join(tempDir, `${fileId}_raw.mp4`);
    const mp3File = path.join(tempDir, `${fileId}.mp3`);

    try {
      // Step 1: Download direct URL via Curl
      console.log(`[YtMusicService] Downloading JioSaavn direct CDN via Curl...`);
      await new Promise((resolve, reject) => {
        const curlBin = process.platform === "win32" ? "curl.exe" : "curl";
        execFile(curlBin, [
          "-L",
          "-o", rawFile,
          "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          cdnUrl
        ], { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) {
            return reject(new Error(`Curl CDN download failed: ${err.message}`));
          }
          if (!fs.existsSync(rawFile) || fs.statSync(rawFile).size < 1000) {
            return reject(new Error("Curl downloaded empty/too-small file"));
          }
          console.log(`[YtMusicService] Curl download done: ${fs.statSync(rawFile).size} bytes`);
          resolve();
        });
      });

      // Step 2: Re-encode to 96kbps MP3 via ffmpeg (reduces size to stay under 8MB payload limit)
      console.log(`[YtMusicService] Compressing to 96kbps MP3 via ffmpeg...`);
      await new Promise((resolve, reject) => {
        const ffmpegBin = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
        execFile(ffmpegBin, ["-y", "-i", rawFile, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "96k", mp3File], { timeout: 60000 }, (err, stdout, stderr) => {
          if (err) return reject(new Error(`ffmpeg compression failed: ${err.message}`));
          if (!fs.existsSync(mp3File) || fs.statSync(mp3File).size < 1000) {
            return reject(new Error(`ffmpeg output file missing or too small`));
          }
          const sizeMB = (fs.statSync(mp3File).size / (1024 * 1024)).toFixed(2);
          console.log(`[YtMusicService] ffmpeg done: ${sizeMB}MB MP3 ready`);
          resolve();
        });
      });

      // Step 3: Read and convert to base64
      const fileBuffer = fs.readFileSync(mp3File);
      const base64Data = fileBuffer.toString("base64");
      console.log(`[YtMusicService] ✅ JioSaavn download+compress succeeded! Base64 length: ${base64Data.length}`);
      return `data:audio/mp3;name=${encodeURIComponent(filename)};base64,${base64Data}`;

    } finally {
      // Cleanup temp files
      try { if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile); } catch (_) {}
      try { if (fs.existsSync(mp3File)) fs.unlinkSync(mp3File); } catch (_) {}
    }
  }

  async downloadAudio(query) {
    let enhancedQuery = query.trim();
    if (!/(song|music|audio|video|lyrics|mp3|official|remix|dlp|cover)/i.test(enhancedQuery)) {
      enhancedQuery = `${enhancedQuery} song`;
      console.log(`[YtMusicService] Query enhanced to: "${enhancedQuery}" for better search accuracy`);
    }

    let resolvedFilename = `${query.trim()}.mp3`;

    // ── STEP 1: JioSaavn CDN → Axios download → ffmpeg compress → base64 ──
    const saavnData = await this.searchJioSaavnUrl(query);
    if (saavnData) {
      resolvedFilename = `${saavnData.title} - ${saavnData.artist}.mp3`
        .replace(/[^a-zA-Z0-9_\-\s\.]/g, "").trim();

      const hasFfmpeg = await checkFfmpeg();

      if (hasFfmpeg) {
        try {
          const audioUri = await this._downloadAndCompress(saavnData.url, resolvedFilename);
          return { uri: audioUri, filename: resolvedFilename, isDirectUrl: false };
        } catch (err) {
          console.warn(`[YtMusicService] JioSaavn direct download failed: ${err.message}`);
        }
      } else {
        console.warn(`[YtMusicService] ffmpeg not available, skipping JioSaavn download`);
      }
    }

    // ── STEP 2: yt-dlp YouTube fallback ──
    const hasYtDlp = await new Promise((resolve) => {
      const bin = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
      execFile(bin, ["--version"], (err) => resolve(!err));
    });

    if (!hasYtDlp) {
      console.warn("[YtMusicService] yt-dlp also not available. Returning silent fallback.");
      return { uri: MOCK_SILENT_MP3, filename: "silent.mp3", isDirectUrl: false };
    }

    const ytUrl = await this.searchYoutubeUrl(enhancedQuery);
    const ytTargets = [];
    if (ytUrl) ytTargets.push({ url: ytUrl, name: "YouTube Direct URL" });
    ytTargets.push({ url: `ytsearch1:${enhancedQuery}`, name: "YouTube Search Query" });

    for (const target of ytTargets) {
      try {
        console.log(`[YtMusicService] Trying yt-dlp: ${target.name}`);
        const audioUri = await this._executeYtDlp(target.url, resolvedFilename);
        if (audioUri) {
          return { uri: audioUri, filename: resolvedFilename, isDirectUrl: false };
        }
      } catch (err) {
        console.warn(`[YtMusicService] yt-dlp failed for ${target.name}:`, err.message);
      }
    }

    throw new Error("All download sources failed.");
  }

  _executeYtDlp(target, filename) {
    return new Promise((resolve, reject) => {
      const tempDir = os.tmpdir();
      const tempFileId = "yt-" + Math.random().toString(36).substring(2, 10);
      const outputPathPattern = path.join(tempDir, `${tempFileId}.%(ext)s`);

      const bin = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
      const args = [
        "--no-check-certificates",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--retries", "3",
        "--fragment-retries", "3",
        "--socket-timeout", "15",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "--max-filesize", "8M",
        "-o", outputPathPattern,
        target
      ];

      console.log(`[YtMusicService] Executing yt-dlp: ${bin} ${args.join(" ")}`);

      execFile(bin, args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          return reject(new Error("yt-dlp failed: " + error.message));
        }
        const expectedFilePath = path.join(tempDir, `${tempFileId}.mp3`);
        if (fs.existsSync(expectedFilePath)) {
          try {
            const fileBuffer = fs.readFileSync(expectedFilePath);
            const audioUri = `data:audio/mp3;name=${encodeURIComponent(filename)};base64,${fileBuffer.toString("base64")}`;
            fs.unlink(expectedFilePath, () => {});
            resolve(audioUri);
          } catch (readErr) {
            reject(new Error("Failed to read yt-dlp output: " + readErr.message));
          }
        } else {
          fs.readdir(tempDir, (err2, files) => {
            if (err2) return reject(new Error("MP3 output not found."));
            const match = files.find(f => f.startsWith(tempFileId) && f.endsWith(".mp3"));
            if (match) {
              const matchPath = path.join(tempDir, match);
              try {
                const fileBuffer = fs.readFileSync(matchPath);
                const audioUri = `data:audio/mp3;name=${encodeURIComponent(filename)};base64,${fileBuffer.toString("base64")}`;
                fs.unlink(matchPath, () => {});
                resolve(audioUri);
              } catch (err) { reject(err); }
            } else {
              reject(new Error("yt-dlp output file not generated."));
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
      console.log(`[YtMusicService] Searching YouTube URL for: "${searchQuery}"`);
      const searchRes = await providers.webSearch(searchQuery);
      if (searchRes && searchRes.results && searchRes.results.length > 0) {
        const match = searchRes.results.find(r => r.url && (r.url.includes("youtube.com/watch") || r.url.includes("youtu.be/")));
        if (match) {
          console.log(`[YtMusicService] Found YouTube URL: ${match.url}`);
          return match.url;
        }
      }
    } catch (err) {
      console.warn(`[YtMusicService] YouTube URL search failed:`, err.message);
    }
    return null;
  }
}

/**
 * Downloads/resolves a song from JioSaavn (primary) or YouTube (fallback).
 */
async function downloadYoutubeAudio(query) {
  return await YtMusicService.instance.downloadAudio(query);
}

module.exports = {
  downloadYoutubeAudio,
  YtMusicService
};
