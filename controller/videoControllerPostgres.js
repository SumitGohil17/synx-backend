import prisma from '../connection/prismaConnection.js';
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

// Get video duration in seconds using FFprobe
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

// Extract frame from video at specific timestamp using FFmpeg
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

// Extract multiple frames from video at regular intervals
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

// Format seconds to HH:MM:SS format
function formatTimestamp(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Format seconds to readable time string
function formatTimeReadable(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}h ${remainingMins}m ${secs}s`;
}

// Analyze single frame with Gemini
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

// Analyze video content with Gemini - comprehensive analysis
async function analyzeVideoWithGemini(videoPath) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const duration = await getVideoDuration(videoPath);
        
        // Extract a representative frame for metadata analysis
        const metadataFramePath = await extractVideoFrame(videoPath, Math.min(2, duration));
        if (!metadataFramePath || !fs.existsSync(metadataFramePath)) {
            console.log('Could not extract frame for analysis');
            return null;
        }

        // Analyze for metadata (title, description, category, tags)
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
        
        // Clean up metadata frame
        if (fs.existsSync(metadataFramePath)) {
            fs.unlinkSync(metadataFramePath);
        }

        // Parse metadata JSON
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

// Detailed timeline analysis of video content - returns comprehensive text description
async function analyzeVideoTimeline(videoPath) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const duration = await getVideoDuration(videoPath);
        
        if (duration === 0) {
            return { duration: 0, fullDescription: 'Could not determine video duration' };
        }

        console.log(`Video duration: ${duration} seconds`);

        // Determine interval based on video length
        let interval;
        if (duration <= 30) {
            interval = 1; // Every second for short videos
        } else if (duration <= 120) {
            interval = 2; // Every 2 seconds for medium videos
        } else if (duration <= 300) {
            interval = 5; // Every 5 seconds for longer videos
        } else {
            interval = 10; // Every 10 seconds for very long videos
        }

        const maxFrames = 60; // Limit to prevent excessive API calls
        const frames = await extractMultipleFrames(videoPath, interval, maxFrames);
        
        console.log(`Extracted ${frames.length} frames for analysis`);

        const frameDescriptions = [];
        
        // Analyze frames in batches to avoid rate limiting
        const batchSize = 5;
        for (let i = 0; i < frames.length; i += batchSize) {
            const batch = frames.slice(i, i + batchSize);
            const batchPromises = batch.map(async (frame) => {
                const description = await analyzeFrameWithGemini(model, frame.path, frame.timestamp);
                
                // Clean up frame file after analysis
                if (fs.existsSync(frame.path)) {
                    fs.unlinkSync(frame.path);
                }
                
                return {
                    timestamp: frame.timestamp,
                    description: description || ''
                };
            });

            const batchResults = await Promise.all(batchPromises);
            frameDescriptions.push(...batchResults);
            
            // Small delay between batches to avoid rate limiting
            if (i + batchSize < frames.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Combine all frame descriptions into one comprehensive text
        const allDescriptions = frameDescriptions
            .filter(f => f.description)
            .map(f => `At ${formatTimeReadable(f.timestamp)}: ${f.description}`)
            .join('\n\n');

        // Generate a comprehensive full description using all frame analysis
        let fullDescription = '';
        try {
            const fullDescPrompt = `You are given frame-by-frame descriptions of a video. Create a single, comprehensive, detailed description of the entire video content. Include:
- What is happening throughout the video from start to end
- All visible elements, people, objects, text, and actions
- The setting/environment and any changes
- The mood, atmosphere, and flow of events
- Any notable transitions or scene changes

Frame descriptions:
${allDescriptions}

Write a detailed paragraph-style description (no bullet points, no timestamps, no JSON). Just describe everything that happens in the video naturally as flowing text. Make it comprehensive and detailed.`;

            const fullDescResult = await model.generateContent(fullDescPrompt);
            fullDescription = fullDescResult.response.text().trim();
        } catch (error) {
            console.log('Error generating full description:', error.message);
            // Fallback to combined frame descriptions
            fullDescription = frameDescriptions
                .filter(f => f.description)
                .map(f => f.description)
                .join(' ');
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

const recentViewsCache = new Map();

function getUserKey(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip || '';
    const ua = req.headers['user-agent'] || '';
    let email = '';
    if (req.body && req.body.email) {
        email = req.body.email;
    } else if (req.user && req.user.email) {
        email = req.user.email;
    }
    return crypto.createHash('sha256').update(ip + ua + email).digest('hex');
}

function recentlyViewed(videoId, userKey, cooldownMs = 60 * 60 * 1000) {
    const key = `${videoId}:${userKey}`;
    const entry = recentViewsCache.get(key);
    if (entry && (Date.now() - entry < cooldownMs)) {
        return true;
    }
    return false;
}

// cache recent view
function cacheRecentView(videoId, userKey) {
    const key = `${videoId}:${userKey}`;
    recentViewsCache.set(key, Date.now());
}


async function hasAudioStream(videoPath) {
    try {
        const normalizedPath = normalizePath(videoPath);
        const { stdout } = await execAsync(
            `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${normalizedPath}"`
        );
        return stdout.trim() === 'audio';
    } catch (error) {
        console.log('No audio stream detected');
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

        let finalAuthorId = authorId;
        if (authorId) {
            let user = await prisma.user.findUnique({ where: { supabaseId: authorId } });
            if (user) {
                finalAuthorId = user.id;
            }
        }

        if (!finalAuthorId) {
            return res.status(400).json({ error: 'Author ID or email is required.' });
        }

        const userExists = await prisma.user.findUnique({
            where: { id: finalAuthorId }
        });

        if (!userExists) {
            return res.status(404).json({ error: 'Author user not found. Please provide a valid authorId or email.' });
        }

        console.log('Processing video upload...');
        const videoId = uuidv4();
        const outputDir = path.join("uploads", `hls_${videoId}`);
        fs.mkdirSync(outputDir, { recursive: true });

        // Normalize paths for FFmpeg
        const normalizedInputPath = normalizePath(inputPath);
        const normalizedOutputDir = normalizePath(outputDir);

        const hasAudio = await hasAudioStream(inputPath);
        console.log(`Video has audio: ${hasAudio}`);

        let ffmpegArgs;

        if (hasAudio) {
            console.log('Starting FFmpeg transcoding with audio...');
            ffmpegArgs = [
                "-i", normalizedInputPath,
                "-filter_complex",
                "[v:0]split=4[v1][v2][v3][v4];" +
                "[v1]scale=w=-2:h=360[v1out];" +
                "[v2]scale=w=-2:h=480[v2out];" +
                "[v3]scale=w=-2:h=720[v3out];" +
                "[v4]scale=w=-2:h=1080[v4out]",
                "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
                "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
                "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
                "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
                "-map", "0:a:0", "-c:a:0", "aac", "-b:a:0", "128k", "-ac", "2",
                "-map", "0:a:0", "-c:a:1", "aac", "-b:a:1", "128k", "-ac", "2",
                "-map", "0:a:0", "-c:a:2", "aac", "-b:a:2", "128k", "-ac", "2",
                "-map", "0:a:0", "-c:a:3", "aac", "-b:a:3", "128k", "-ac", "2",
                "-f", "hls",
                "-hls_time", "6",
                "-hls_playlist_type", "vod",
                "-hls_segment_filename", `${normalizedOutputDir}/v%v/segment_%03d.ts`,
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3",
                `${normalizedOutputDir}/v%v/index.m3u8`
            ];
        } else {
            console.log('Starting FFmpeg transcoding without audio...');
            ffmpegArgs = [
                "-i", normalizedInputPath,
                "-filter_complex",
                "[v:0]split=4[v1][v2][v3][v4];" +
                "[v1]scale=w=-2:h=360[v1out];" +
                "[v2]scale=w=-2:h=480[v2out];" +
                "[v3]scale=w=-2:h=720[v3out];" +
                "[v4]scale=w=-2:h=1080[v4out]",
                "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
                "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
                "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
                "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
                "-f", "hls",
                "-hls_time", "6",
                "-hls_playlist_type", "vod",
                "-hls_segment_filename", `${normalizedOutputDir}/v%v/segment_%03d.ts`,
                "-master_pl_name", "master.m3u8",
                "-var_stream_map", "v:0 v:1 v:2 v:3",
                `${normalizedOutputDir}/v%v/index.m3u8`
            ];
        }

        // Run ffmpeg
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn("ffmpeg", ffmpegArgs);

            let errorOutput = '';

            ffmpeg.stderr.on("data", (data) => {
                const output = data.toString();
                console.log(output);
                errorOutput += output;
            });

            ffmpeg.on("close", (code) => {
                if (code === 0) {
                    console.log('FFmpeg transcoding completed successfully');
                    resolve();
                } else {
                    console.error('FFmpeg failed with code', code);
                    console.error('Error output:', errorOutput);
                    reject(new Error(`FFmpeg failed with code ${code}`));
                }
            });

            ffmpeg.on("error", (error) => {
                console.error('FFmpeg process error:', error);
                reject(error);
            });
        });

        console.log('Transcoding complete. Uploading to S3...');

        const uploadFiles = async (dir, prefix = "") => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const s3Key = path.join("hls", videoId, prefix, file).replace(/\\/g, "/");

                if (fs.statSync(filePath).isDirectory()) {
                    await uploadFiles(filePath, path.join(prefix, file));
                } else {
                    const fileBuffer = fs.readFileSync(filePath);
                    const contentType = file.endsWith(".m3u8")
                        ? "application/vnd.apple.mpegurl"
                        : "video/mp2t";

                    const uploadParams = {
                        Bucket: bucketName,
                        Key: s3Key,
                        Body: fileBuffer,
                        ContentType: contentType
                    };

                    try {
                        const command = new PutObjectCommand(uploadParams);
                        await s3Client.send(command);
                        console.log(`Uploaded ${s3Key}`);
                    } catch (error) {
                        console.error(`Failed to upload ${s3Key}:`, error);
                        throw error;
                    }
                }
            }
        };

        await uploadFiles(outputDir);

        console.log('Cleaning up temporary files...');
        fs.unlinkSync(inputPath);
        fs.rmSync(outputDir, { recursive: true, force: true });

        const masterPlaylistKey = `hls/${videoId}/master.m3u8`;
        const inputPath2 = `https://s3.${process.env.AWS_REGION}.amazonaws.com/${bucketName}/${masterPlaylistKey}`;

        const video = await prisma.video.create({
            data: {
                title,
                description,
                thumbnail: thumbnail || null,
                tags: parsedTags,
                category: category || 'other',
                author: author || userExists.username,
                authorId: finalAuthorId,
                duration: duration || 0,
                url: inputPath2,
                mimeType: 'application/vnd.apple.mpegurl',
                fileSize: req.file?.size || 0
            },
            include: {
                authorUser: {
                    select: { id: true, username: true, email: true }
                }
            }
        });

        res.status(201).json({
            success: true,
            message: 'Video uploaded successfully',
            video
        });
    } catch (error) {
        console.error('Video upload error:', error);

        // Cleanup on error
        try {
            if (inputPath && fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }

        res.status(500).json({
            success: false,
            message: 'Error uploading video',
            error: error.message
        });
    }
};

const getAllVideos = async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', category = '' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

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
                where,
                skip,
                take: parseInt(limit),
                include: {
                    authorUser: {
                        select: { id: true, username: true, email: true }
                    },
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

        res.status(200).json({
            success: true,
            count: videosWithCounts.length,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            videos: videosWithCounts
        });
    } catch (error) {
        console.error('Get videos error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching videos',
            error: error.message
        });
    }
};

const getVideoById = async (req, res) => {
    try {
        const { id } = req.params;
        const video = await prisma.video.findUnique({
            where: { id },
            include: {
                authorUser: {
                    select: { id: true, username: true, email: true }
                },
                comments: {
                    include: {
                        user: { select: { username: true, email: true } }
                    },
                    orderBy: { createdAt: 'desc' }
                },
                videoLikes: { select: { userId: true } }
            }
        });

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        res.status(200).json({ success: true, video });
    } catch (error) {
        console.error('Get video error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching video',
            error: error.message
        });
    }
};

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

        res.status(200).json({ success: true, video });
    } catch (error) {
        console.error('Update video error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating video',
            error: error.message
        });
    }
};

const deleteVideo = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.video.delete({ where: { id } });

        res.status(200).json({
            success: true,
            message: 'Video deleted successfully'
        });
    } catch (error) {
        console.error('Delete video error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting video',
            error: error.message
        });
    }
};

// REST fallback for incrementing views
const incrementVideoViews = async (req, res) => {
    try {
        const { id } = req.params;
        const video = await prisma.video.update({
            where: { id },
            data: { views: { increment: 1 } }
        });

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }
        res.status(200).json({ success: true, views: video.views });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error incrementing views', error: error.message });
    }
};

// YouTube-style reliable view counting
const reliableViewCount = async (req, res) => {
    try {
        const { id } = req.params;
        const { watchTime } = req.body;

        if (!watchTime || watchTime < 20) {
            return res.status(400).json({ success: false, message: 'Watch time too short for valid view.' });
        }

        const userKey = getUserKey(req);

        if (recentlyViewed(id, userKey, 60 * 60 * 1000)) {
            return res.status(200).json({ success: false, message: 'View already counted recently for this user.' });
        }

        const video = await prisma.video.update({
            where: { id },
            data: { views: { increment: 1 } }
        });

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        cacheRecentView(id, userKey);
        res.status(200).json({ success: true, views: video.views });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error incrementing views', error: error.message });
    }
};

const analyzeVideo = async (req, res) => {
    const videoPath = req.file?.path;
    const { detailed = 'true' } = req.query; // Option to get detailed timeline analysis

    if (!videoPath) {
        return res.status(400).json({ success: false, message: 'Video file is required' });
    }

    try {
        console.log('Analyzing video with Gemini...');
        
        // Get basic metadata (title, description, category, tags)
        const aiData = await analyzeVideoWithGemini(videoPath);
        
        let timelineData = null;
        
        // If detailed analysis is requested, analyze the full timeline
        if (detailed === 'true') {
            console.log('Performing detailed timeline analysis...');
            timelineData = await analyzeVideoTimeline(videoPath);
        }

        // Clean up uploaded file after analysis
        if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }

        if (!aiData && !timelineData) {
            return res.status(200).json({
                success: true,
                data: {
                    title: '',
                    description: '',
                    category: 'Other',
                    tags: [],
                    timeline: null
                }
            });
        }

        res.status(200).json({
            success: true,
            data: {
                title: aiData?.title || '',
                description: aiData?.description || '',
                category: aiData?.category || 'Other',
                tags: aiData?.tags || [],
                // Full video content description
                duration: timelineData?.duration || 0,
                durationFormatted: timelineData?.durationFormatted || '',
                framesAnalyzed: timelineData?.framesAnalyzed || 0,
                fullVideoDescription: timelineData?.fullDescription || ''
            }
        });
    } catch (error) {
        // Clean up file on error
        if (fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }
        res.status(500).json({ success: false, message: error.message });
    }
};

export {
    videoController,
    getAllVideos,
    getVideoById,
    updateVideo,
    deleteVideo,
    incrementVideoViews,
    reliableViewCount,
    analyzeVideo
};
