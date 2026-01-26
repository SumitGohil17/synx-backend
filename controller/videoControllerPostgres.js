import prisma from '../connection/prismaConnection.js';
import redis from '../connection/redisConnection.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();
import { v4 as uuidv4 } from "uuid";
import crypto from 'crypto';
import { promisify } from 'util';
import { exec, spawn } from 'child_process';
import { 
    getCache, setCache, getCacheOrFetch,
    invalidateVideoCache, invalidateUserVideos,
    deleteCachePattern,
    CACHE_KEYS, CACHE_TTL 
} from '../utils/cacheUtils.js';

const execAsync = promisify(exec);

// Helper to normalize paths for FFmpeg
function normalizePath(p) {
    return p.replace(/\\/g, '/');
}

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// Gemini AI Configuration
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function getVideoDuration(videoPath) {
    try {
        const normalizedPath = normalizePath(videoPath);
        const { stdout } = await execAsync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${normalizedPath}"`
        );
        return Math.floor(parseFloat(stdout.trim()));
    } catch (error) {
        console.log('Error getting video duration:', error.message);
        return 0;
    }
}

async function extractVideoFrame(videoPath, timestamp = 2) {
    const outputPath = videoPath + `_frame_${timestamp}.jpg`;
    try {
        const timeStr = formatTimestamp(timestamp);
        await execAsync(`ffmpeg -i "${videoPath}" -ss ${timeStr} -frames:v 1 -q:v 2 "${outputPath}" -y`);
        return outputPath;
    } catch (error) {
        console.log(`Error extracting frame at ${timestamp}s:`, error.message);
        return null;
    }
}

async function extractMultipleFrames(videoPath, intervalSeconds = 2, maxFrames = 30) {
    const duration = await getVideoDuration(videoPath);
    if (duration === 0) return [];

    const frames = [];
    const actualInterval = Math.max(intervalSeconds, Math.ceil(duration / maxFrames));
    
    for (let time = 0; time < duration; time += actualInterval) {
        const framePath = await extractVideoFrame(videoPath, time);
        if (framePath && fs.existsSync(framePath)) {
            frames.push({ timestamp: time, path: framePath });
        }
    }
    
    return frames;
}

function formatTimestamp(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTimeReadable(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m ${secs}s`;
}

async function analyzeFrameWithGemini(model, framePath, timestamp) {
    try {
        const imageData = fs.readFileSync(framePath);
        const base64Image = imageData.toString('base64');

        const prompt = `Analyze this video frame captured at ${formatTimeReadable(timestamp)} and describe in detail what is happening. Include:
- Main subjects/people and their actions
- Environment/setting details
- Any visible text, objects, or notable elements
- Mood/atmosphere of the scene

Provide a concise but detailed description (2-3 sentences). Return ONLY the description text, no JSON or formatting.`;

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            }
        ]);

        return result.response.text().trim();
    } catch (error) {
        console.log(`Error analyzing frame at ${timestamp}s:`, error.message);
        return null;
    }
}

async function analyzeVideoWithGemini(videoPath) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const duration = await getVideoDuration(videoPath);
        
        const metadataFramePath = await extractVideoFrame(videoPath, Math.min(2, duration));
        if (!metadataFramePath || !fs.existsSync(metadataFramePath)) {
            console.log('Could not extract frame for analysis');
            return null;
        }

        const imageData = fs.readFileSync(metadataFramePath);
        const base64Image = imageData.toString('base64');

        const metadataPrompt = `Analyze this video frame and provide the following in JSON format only (no markdown, no code blocks):
{
  "title": "A catchy title for this video (max 80 chars)",
  "description": "A detailed description of what's happening (max 500 chars)",
  "category": "One of: Entertainment, Education, Gaming, Music, Sports, News, Technology, Comedy, Vlogs, Other",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}
Provide ONLY the JSON, nothing else.`;

        const metadataResult = await model.generateContent([
            metadataPrompt,
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: base64Image
                }
            }
        ]);

        const metadataResponse = metadataResult.response.text();
        
        if (fs.existsSync(metadataFramePath)) {
            fs.unlinkSync(metadataFramePath);
        }

        let metadata = null;
        const jsonMatch = metadataResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            metadata = JSON.parse(jsonMatch[0]);
        }

        return metadata;
    } catch (error) {
        console.error('Gemini analysis error:', error.message);
        return null;
    }
}

async function analyzeVideoTimeline(videoPath) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const duration = await getVideoDuration(videoPath);
        
        if (duration === 0) {
            return { duration: 0, fullDescription: 'Could not determine video duration' };
        }

        let interval;
        if (duration <= 30) interval = 1;
        else if (duration <= 120) interval = 2;
        else if (duration <= 300) interval = 5;
        else interval = 10;

        const maxFrames = 60;
        const frames = await extractMultipleFrames(videoPath, interval, maxFrames);

        const frameDescriptions = [];
        const batchSize = 5;
        
        for (let i = 0; i < frames.length; i += batchSize) {
            const batch = frames.slice(i, i + batchSize);
            const batchPromises = batch.map(async (frame) => {
                const description = await analyzeFrameWithGemini(model, frame.path, frame.timestamp);
                if (fs.existsSync(frame.path)) fs.unlinkSync(frame.path);
                return { timestamp: frame.timestamp, description: description || '' };
            });

            const batchResults = await Promise.all(batchPromises);
            frameDescriptions.push(...batchResults);
            
            if (i + batchSize < frames.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const allDescriptions = frameDescriptions
            .filter(f => f.description)
            .map(f => `At ${formatTimeReadable(f.timestamp)}: ${f.description}`)
            .join('\n\n');

        let fullDescription = '';
        try {
            const fullDescPrompt = `You are given frame-by-frame descriptions of a video. Create a single, comprehensive, detailed description of the entire video content.

Frame descriptions:
${allDescriptions}

Write a detailed paragraph-style description. Make it comprehensive and detailed.`;

            const fullDescResult = await model.generateContent(fullDescPrompt);
            fullDescription = fullDescResult.response.text().trim();
        } catch (error) {
            fullDescription = frameDescriptions.filter(f => f.description).map(f => f.description).join(' ');
        }

        return {
            duration,
            durationFormatted: formatTimeReadable(duration),
            framesAnalyzed: frames.length,
            fullDescription
        };
    } catch (error) {
        console.error('Timeline analysis error:', error.message);
        return null;
    }
}

const bucketName = process.env.S3_BUCKET_NAME;

function generateUserFingerprint(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    let email = '';
    if (req.body?.email) email = req.body.email;
    else if (req.user?.email) email = req.user.email;
    return crypto.createHash('sha256').update(ip + ua + email).digest('hex').substring(0, 32);
}

async function isRecentlyViewed(videoId, fingerprint) {
    try {
        const key = `view:recent:${videoId}:${fingerprint}`;
        const exists = await redis.exists(key);
        return exists === 1;
    } catch (error) {
        console.error('Redis view check error:', error.message);
        return false;
    }
}

async function markViewCounted(videoId, fingerprint) {
    try {
        const key = `view:recent:${videoId}:${fingerprint}`;
        await redis.setex(key, 3600, '1'); // 1 hour cooldown
    } catch (error) {
        console.error('Redis mark view error:', error.message);
    }
}

async function queueViewUpdate(videoId) {
    try {
        await redis.hincrby('pending_views', videoId, 1);
    } catch (error) {
        console.error('Queue view error:', error.message);
    }
}

// Batch process pending views every 30 seconds
async function processPendingViews() {
    try {
        const pending = await redis.hgetall('pending_views');
        if (Object.keys(pending).length === 0) return;

        await redis.del('pending_views');

        const updates = Object.entries(pending).map(([videoId, count]) =>
            prisma.video.update({
                where: { id: videoId },
                data: { views: { increment: parseInt(count) } }
            }).catch(err => console.error(`View update failed for ${videoId}:`, err.message))
        );

        await Promise.all(updates);
        console.log(`✅ Processed ${Object.keys(pending).length} view updates`);
    } catch (error) {
        console.error('Batch view update error:', error.message);
    }
}

// Start batch processing interval
setInterval(processPendingViews, 30000);

async function hasAudioStream(videoPath) {
    try {
        const normalizedPath = normalizePath(videoPath);
        const { stdout } = await execAsync(
            `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${normalizedPath}"`
        );
        return stdout.trim() === 'audio';
    } catch (error) {
        return false;
    }
}

const videoController = async (req, res) => {
    let { title, description, thumbnail, tags, category, author, duration, authorId } = req.body;
    const inputPath = req.file?.path;

    if (!inputPath) {
        return res.status(400).json({ error: 'Video file is required.' });
    }

    try {
        let parsedTags = [];
        if (tags) {
            try {
                parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
            } catch {
                parsedTags = tags.split(',').map(t => t.trim());
            }
        }

        // Get user with Redis cache
        let finalAuthorId = authorId;
        if (authorId) {
            const userCacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${authorId}`;
            let user = await getCache(userCacheKey);
            
            if (!user) {
                user = await prisma.user.findUnique({ where: { supabaseId: authorId } });
                if (user) await setCache(userCacheKey, user, CACHE_TTL.USER);
            }
            
            if (user) finalAuthorId = user.id;
        }

        if (!finalAuthorId) {
            return res.status(400).json({ error: 'Author ID or email is required.' });
        }

        const userExists = await prisma.user.findUnique({ where: { id: finalAuthorId } });
        if (!userExists) {
            return res.status(404).json({ error: 'Author user not found.' });
        }

        console.log('Processing video upload...');
        const videoId = uuidv4();
        const outputDir = path.join("uploads", `hls_${videoId}`);
        fs.mkdirSync(outputDir, { recursive: true });

        const normalizedInputPath = normalizePath(inputPath);
        const normalizedOutputDir = normalizePath(outputDir);
        const hasAudio = await hasAudioStream(inputPath);

        let ffmpegArgs;
        if (hasAudio) {
            ffmpegArgs = [
                "-i", normalizedInputPath,
                "-filter_complex",
                "[v:0]split=4[v1][v2][v3][v4];[v1]scale=w=-2:h=360[v1out];[v2]scale=w=-2:h=480[v2out];[v3]scale=w=-2:h=720[v3out];[v4]scale=w=-2:h=1080[v4out]",
                "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
                "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
                "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
                "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
                "-map", "0:a:0", "-c:a:0", "aac", "-b:a:0", "128k", "-ac", "2",
                "-map", "0:a:0", "-c:a:1", "aac", "-b:a:1", "128k", "-ac", "2",
                "-map", "0:a:0", "-c:a:2", "aac", "-b:a:2", "128k", "-ac", "2",
                "-map", "0:a:0", "-c:a:3", "aac", "-b:a:3", "128k", "-ac", "2",
                "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
                "-hls_segment_filename", `${normalizedOutputDir}/v%v/segment_%03d.ts`,
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3",
                `${normalizedOutputDir}/v%v/index.m3u8`
            ];
        } else {
            ffmpegArgs = [
                "-i", normalizedInputPath,
                "-filter_complex",
                "[v:0]split=4[v1][v2][v3][v4];[v1]scale=w=-2:h=360[v1out];[v2]scale=w=-2:h=480[v2out];[v3]scale=w=-2:h=720[v3out];[v4]scale=w=-2:h=1080[v4out]",
                "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
                "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
                "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
                "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
                "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
                "-hls_segment_filename", `${normalizedOutputDir}/v%v/segment_%03d.ts`,
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", "v:0 v:1 v:2 v:3",
                `${normalizedOutputDir}/v%v/index.m3u8`
            ];
        }

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", ffmpegArgs);
            let errorOutput = '';
            ffmpeg.stderr.on("data", (data) => { errorOutput += data.toString(); });
            ffmpeg.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg failed: ${code}`)));
            ffmpeg.on("error", reject);
        });

        const uploadFiles = async (dir, prefix = "") => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const s3Key = path.join("hls", videoId, prefix, file).replace(/\\/g, "/");

                if (fs.statSync(filePath).isDirectory()) {
                    await uploadFiles(filePath, path.join(prefix, file));
                } else {
                    const fileBuffer = fs.readFileSync(filePath);
                    await s3Client.send(new PutObjectCommand({
                        Bucket: bucketName,
                        Key: s3Key,
                        Body: fileBuffer,
                        ContentType: file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t"
                    }));
                }
            }
        };

        await uploadFiles(outputDir);

        fs.unlinkSync(inputPath);
        fs.rmSync(outputDir, { recursive: true, force: true });

        const masterPlaylistKey = `hls/${videoId}/master.m3u8`;
        const videoUrl = `https://s3.${process.env.AWS_REGION}.amazonaws.com/${bucketName}/${masterPlaylistKey}`;

        const video = await prisma.video.create({
            data: {
                title, description,
                thumbnail: thumbnail || null,
                tags: parsedTags,
                category: category || 'other',
                author: author || userExists.username,
                authorId: finalAuthorId,
                duration: duration || 0,
                url: videoUrl,
                mimeType: 'application/vnd.apple.mpegurl',
                fileSize: req.file?.size || 0
            },
            include: { authorUser: { select: { id: true, username: true, email: true } } }
        });

        // Invalidate video caches after upload
        await invalidateUserVideos(finalAuthorId);
        await deleteCachePattern(`${CACHE_KEYS.VIDEO_LIST}*`);

        res.status(201).json({ success: true, message: 'Video uploaded successfully', video });
    } catch (error) {
        console.error('Video upload error:', error);
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        res.status(500).json({ success: false, message: 'Error uploading video', error: error.message });
    }
};

const getAllVideos = async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', category = '' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Create cache key based on query params
        const cacheKey = `${CACHE_KEYS.VIDEO_LIST}page:${page}:limit:${limit}:search:${search}:category:${category}`;
        
        // Try cache first (only for non-search queries)
        if (!search) {
            const cached = await getCache(cacheKey);
            if (cached) {
                return res.status(200).json({ ...cached, cached: true });
            }
        }

        const where = {
            ...(search && {
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                    { author: { contains: search, mode: 'insensitive' } }
                ]
            }),
            ...(category && { category })
        };

        const [videos, total] = await Promise.all([
            prisma.video.findMany({
                where, skip,
                take: parseInt(limit),
                include: {
                    authorUser: { select: { id: true, username: true, email: true } },
                    comments: { select: { id: true } },
                    videoLikes: { select: { id: true } }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.video.count({ where })
        ]);

        const videosWithCounts = videos.map(video => ({
            ...video,
            commentsCount: video.comments.length,
            likesCount: video.videoLikes.length,
            comments: undefined,
            videoLikes: undefined
        }));

        const result = {
            success: true,
            count: videosWithCounts.length,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            videos: videosWithCounts
        };

        // Cache only non-search results
        if (!search) {
            await setCache(cacheKey, result, CACHE_TTL.VIDEO_LIST);
        }

        res.status(200).json({ ...result, cached: false });
    } catch (error) {
        console.error('Get videos error:', error);
        res.status(500).json({ success: false, message: 'Error fetching videos', error: error.message });
    }
};

const getVideoById = async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `${CACHE_KEYS.VIDEO}${id}`;
        
        const { data: video, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                return await prisma.video.findUnique({
                    where: { id },
                    include: {
                        authorUser: { select: { id: true, username: true, email: true } },
                        comments: {
                            include: { user: { select: { username: true, email: true } } },
                            orderBy: { createdAt: 'desc' }
                        },
                        videoLikes: { select: { userId: true } }
                    }
                });
            },
            CACHE_TTL.VIDEO
        );

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        res.status(200).json({ success: true, video, cached: fromCache });
    } catch (error) {
        console.error('Get video error:', error);
        res.status(500).json({ success: false, message: 'Error fetching video', error: error.message });
    }
};

// UPDATE VIDEO WITH CACHE INVALIDATION
const updateVideo = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, category, author, thumbnail, tags } = req.body;

        const video = await prisma.video.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(description && { description }),
                ...(category && { category }),
                ...(author && { author }),
                ...(thumbnail && { thumbnail }),
                ...(tags && { tags: typeof tags === 'string' ? JSON.parse(tags) : tags })
            }
        });

        // Invalidate video cache
        await invalidateVideoCache(id);

        res.status(200).json({ success: true, video });
    } catch (error) {
        console.error('Update video error:', error);
        res.status(500).json({ success: false, message: 'Error updating video', error: error.message });
    }
};

const deleteVideo = async (req, res) => {
    try {
        const { id } = req.params;
        
        const video = await prisma.video.findUnique({ where: { id } });
        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        await prisma.video.delete({ where: { id } });

        // Invalidate all related caches
        await invalidateVideoCache(id);
        await invalidateUserVideos(video.authorId);

        res.status(200).json({ success: true, message: 'Video deleted successfully' });
    } catch (error) {
        console.error('Delete video error:', error);
        res.status(500).json({ success: false, message: 'Error deleting video', error: error.message });
    }
};

const incrementVideoViews = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Queue view for batch processing
        await queueViewUpdate(id);
        
        // Get current views from cache or DB
        const cacheKey = `${CACHE_KEYS.VIEW_COUNT}${id}`;
        let views = await getCache(cacheKey);
        
        if (views === null) {
            const video = await prisma.video.findUnique({ 
                where: { id }, 
                select: { views: true } 
            });
            views = video?.views || 0;
        }
        
        // Return incremented count (actual update happens in batch)
        res.status(200).json({ success: true, views: views + 1 });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error incrementing views', error: error.message });
    }
};

// REDIS-BASED RELIABLE VIEW COUNT (YouTube-style)
const reliableViewCount = async (req, res) => {
    try {
        const { id } = req.params;
        const { watchTime } = req.body;

        // Minimum watch time validation
        if (!watchTime || watchTime < 5) {
            return res.status(200).json({ 
                success: false, 
                counted: false,
                message: 'Watch time too short for valid view.' 
            });
        }

        const fingerprint = generateUserFingerprint(req);

        // Check Redis for recent view
        if (await isRecentlyViewed(id, fingerprint)) {
            // Get current view count
            const video = await prisma.video.findUnique({ 
                where: { id }, 
                select: { views: true } 
            });
            return res.status(200).json({ 
                success: true, 
                counted: false,
                views: video?.views || 0,
                message: 'View already counted recently for this user.' 
            });
        }

        // Mark as viewed and queue update
        await markViewCounted(id, fingerprint);
        await queueViewUpdate(id);

        // Get current count + 1
        const video = await prisma.video.findUnique({ 
            where: { id }, 
            select: { views: true } 
        });

        res.status(200).json({ 
            success: true, 
            counted: true,
            views: (video?.views || 0) + 1 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error incrementing views', error: error.message });
    }
};

// GET TRENDING VIDEOS WITH REDIS CACHE
const getTrendingVideos = async (req, res) => {
    try {
        const { limit = 20 } = req.query;
        const cacheKey = `${CACHE_KEYS.VIDEO_TRENDING}:limit:${limit}`;
        
        const { data: videos, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                return await prisma.video.findMany({
                    take: parseInt(limit),
                    orderBy: [
                        { views: 'desc' },
                        { createdAt: 'desc' }
                    ],
                    include: {
                        authorUser: { select: { id: true, username: true } },
                        _count: { select: { videoLikes: true, comments: true } }
                    }
                });
            },
            CACHE_TTL.TRENDING
        );

        res.status(200).json({ success: true, videos, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching trending', error: error.message });
    }
};

// GET VIDEOS BY USER WITH REDIS CACHE
const getVideosByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const cacheKey = `${CACHE_KEYS.VIDEO_BY_USER}${userId}:page:${page}`;
        
        const { data, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                const videos = await prisma.video.findMany({
                    where: { authorId: userId },
                    skip: (parseInt(page) - 1) * parseInt(limit),
                    take: parseInt(limit),
                    orderBy: { createdAt: 'desc' },
                    include: {
                        _count: { select: { videoLikes: true, comments: true } }
                    }
                });
                const total = await prisma.video.count({ where: { authorId: userId } });
                return { videos, total };
            },
            CACHE_TTL.VIDEO_BY_USER
        );

        res.status(200).json({ 
            success: true, 
            videos: data.videos, 
            total: data.total,
            cached: fromCache 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching user videos', error: error.message });
    }
};

// ANALYZE VIDEO (no caching needed - one-time operation)
const analyzeVideo = async (req, res) => {
    const videoPath = req.file?.path;
    const { detailed = 'true' } = req.query;

    if (!videoPath) {
        return res.status(400).json({ success: false, message: 'Video file is required' });
    }

    try {
        console.log('Analyzing video with Gemini...');
        
        const aiData = await analyzeVideoWithGemini(videoPath);
        let timelineData = null;
        
        if (detailed === 'true') {
            timelineData = await analyzeVideoTimeline(videoPath);
        }

        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

        res.status(200).json({
            success: true,
            data: {
                title: aiData?.title || '',
                description: aiData?.description || '',
                category: aiData?.category || 'Other',
                tags: aiData?.tags || [],
                duration: timelineData?.duration || 0,
                durationFormatted: timelineData?.durationFormatted || '',
                framesAnalyzed: timelineData?.framesAnalyzed || 0,
                fullVideoDescription: timelineData?.fullDescription || ''
            }
        });
    } catch (error) {
        if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Force sync pending views to database
const syncPendingViews = async (req, res) => {
    try {
        await processPendingViews();
        res.status(200).json({ success: true, message: 'Views synced to database' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export {
    videoController,
    getAllVideos,
    getVideoById,
    getVideosByUser,
    getTrendingVideos,
    updateVideo,
    deleteVideo,
    incrementVideoViews,
    reliableViewCount,
    analyzeVideo,
    syncPendingViews
};
