import prisma from '../connection/prismaConnection.js';
// import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import crypto from 'crypto';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

dotenv.config();

// const s3Client = new S3Client({
//     region: process.env.AWS_REGION,
//     credentials: {
//         accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
//     }
// });

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
        const { stdout } = await execAsync(
            `ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
        );
        return stdout.trim() === 'audio';
    } catch (error) {
        console.log('No audio stream detected');
        return false;
    }
}

const videoController = async (req, res) => {
    const { title, description, thumbnail, tags, category, author, duration, authorId } = req.body;
    const inputPath = req.file.path;

    if (!inputPath) {
        return res.status(400).json({ error: 'Video file is required.' });
    }

    if (!title || !description) {
        return res.status(400).json({ error: 'Title and description are required.' });
    }

    try {
        let parsedTags = [];
        if (tags) {
            parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
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
        // const videoId = uuidv4();
        // const outputDir = path.join("uploads", `hls_${videoId}`);
        // fs.mkdirSync(outputDir, { recursive: true });

        // const hasAudio = await hasAudioStream(inputPath);
        // console.log(`Video has audio: ${hasAudio}`);

        // let ffmpegArgs;

        // if (hasAudio) {
        //     console.log('Starting FFmpeg transcoding with audio...');
        //     ffmpegArgs = [
        //         "-i", inputPath,
        //         "-filter_complex",
        //         "[v:0]split=4[v1][v2][v3][v4];" +
        //         "[v1]scale=w=-2:h=360[v1out];" +
        //         "[v2]scale=w=-2:h=480[v2out];" +
        //         "[v3]scale=w=-2:h=720[v3out];" +
        //         "[v4]scale=w=-2:h=1080[v4out]",
        //         "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
        //         "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
        //         "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
        //         "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
        //         "-map", "0:a:0", "-c:a:0", "aac", "-b:a:0", "128k", "-ac", "2",
        //         "-map", "0:a:0", "-c:a:1", "aac", "-b:a:1", "128k", "-ac", "2",
        //         "-map", "0:a:0", "-c:a:2", "aac", "-b:a:2", "128k", "-ac", "2",
        //         "-map", "0:a:0", "-c:a:3", "aac", "-b:a:3", "128k", "-ac", "2",
        //         "-f", "hls",
        //         "-hls_time", "6",
        //         "-hls_playlist_type", "vod",
        //         "-hls_segment_filename", `${outputDir}/v%v/segment_%03d.ts`,
        //         "-master_pl_name", "master.m3u8",
        //         "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3",
        //         `${outputDir}/v%v/index.m3u8`
        //     ];
        // } else {
        //     console.log('Starting FFmpeg transcoding without audio...');
        //     ffmpegArgs = [
        //         "-i", inputPath,
        //         "-filter_complex",
        //         "[v:0]split=4[v1][v2][v3][v4];" +
        //         "[v1]scale=w=-2:h=360[v1out];" +
        //         "[v2]scale=w=-2:h=480[v2out];" +
        //         "[v3]scale=w=-2:h=720[v3out];" +
        //         "[v4]scale=w=-2:h=1080[v4out]",
        //         "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
        //         "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
        //         "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
        //         "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
        //         "-f", "hls",
        //         "-hls_time", "6",
        //         "-hls_playlist_type", "vod",
        //         "-hls_segment_filename", `${outputDir}/v%v/segment_%03d.ts`,
        //         "-master_pl_name", "master.m3u8",
        //         "-var_stream_map", "v:0 v:1 v:2 v:3",
        //         `${outputDir}/v%v/index.m3u8`
        //     ];
        // }

        // // Run ffmpeg
        // await new Promise((resolve, reject) => {
        //     const ffmpeg = spawn("ffmpeg", ffmpegArgs);

        //     let errorOutput = '';

        //     ffmpeg.stderr.on("data", (data) => {
        //         const output = data.toString();
        //         console.log(output);
        //         errorOutput += output;
        //     });

        //     ffmpeg.on("close", (code) => {
        //         if (code === 0) {
        //             console.log('FFmpeg transcoding completed successfully');
        //             resolve();
        //         } else {
        //             console.error('FFmpeg failed with code', code);
        //             console.error('Error output:', errorOutput);
        //             reject(new Error(`FFmpeg failed with code ${code}`));
        //         }
        //     });

        //     ffmpeg.on("error", (error) => {
        //         console.error('FFmpeg process error:', error);
        //         reject(error);
        //     });
        // });

        // console.log('Transcoding complete. Uploading to S3...');

        // const uploadFiles = async (dir, prefix = "") => {
        //     const files = fs.readdirSync(dir);
        //     for (const file of files) {
        //         const filePath = path.join(dir, file);
        //         const s3Key = path.join("hls", videoId, prefix, file).replace(/\\/g, "/");

        //         if (fs.statSync(filePath).isDirectory()) {
        //             await uploadFiles(filePath, path.join(prefix, file));
        //         } else {
        //             const fileBuffer = fs.readFileSync(filePath);
        //             const contentType = file.endsWith(".m3u8")
        //                 ? "application/vnd.apple.mpegurl"
        //                 : "video/mp2t";

        //             const uploadParams = {
        //                 Bucket: bucketName,
        //                 Key: s3Key,
        //                 Body: fileBuffer,
        //                 ContentType: contentType
        //             };

        //             try {
        //                 const command = new PutObjectCommand(uploadParams);
        //                 await s3Client.send(command);
        //                 console.log(`Uploaded ${s3Key}`);
        //             } catch (error) {
        //                 console.error(`Failed to upload ${s3Key}:`, error);
        //                 throw error;
        //             }
        //         }
        //     }
        // };

        // await uploadFiles(outputDir);

        // console.log('Cleaning up temporary files...');
        // fs.unlinkSync(inputPath);
        // fs.rmSync(outputDir, { recursive: true, force: true });

        // const masterPlaylistKey = `hls/${videoId}/master.m3u8`;
        // const masterUrl = `https://s3.${process.env.AWS_REGION}.amazonaws.com/${bucketName}/${masterPlaylistKey}`;

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
                url: inputPath,
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
            message: 'Video uploaded and transcoded successfully',
            video,
            hlsUrl: masterUrl,
            hasAudio,
            qualities: ['360p', '480p', '720p', '1080p']
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

export {
    videoController,
    getAllVideos,
    getVideoById,
    updateVideo,
    deleteVideo,
    incrementVideoViews,
    reliableViewCount
};
