import prisma from '../connection/prismaConnection.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config();
import { v4 as uuidv4 } from "uuid";
import { promisify } from 'util';
import { exec, spawn } from 'child_process';
import { 
    getCache, setCache, getCacheOrFetch,
    invalidateShortsCache,
    CACHE_KEYS, CACHE_TTL 
} from '../utils/cacheUtils.js';

const execAsync = promisify(exec);


function normalizePath(p) {
    return p.replace(/\\/g, '/');
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

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});
const bucketName = process.env.S3_BUCKET_NAME;

export const createShort = async (req, res) => {
    const inputPath = req.file.path;
    const { title, description, authorName, authorId, tags, category } = req.body;

    try {
        let parsedTags = [];
        if (tags) {
            try {
                parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
            } catch {
                parsedTags = tags.split(',').map(t => t.trim());
            }
        }

        // Get user with cache
        const userCacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${authorId}`;
        let user = await getCache(userCacheKey);
        
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: authorId } });
            if (user) await setCache(userCacheKey, user, CACHE_TTL.USER);
        }

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found. Please sync user first.' });
        }

        console.log('Processing short video upload...');
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

        const short = await prisma.shortsVideo.create({
            data: { 
                title, 
                description, 
                url: videoUrl, 
                tags: parsedTags, 
                category, 
                author: authorName, 
                authorId: user.id 
            },
            include: { authorUser: { select: { id: true, username: true, email: true } } }
        });

        // Invalidate shorts cache
        await invalidateShortsCache();

        res.status(201).json({ success: true, short });
    } catch (error) {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        res.status(500).json({ success: false, message: 'Error creating short', error: error.message });
    }
};

export const getShorts = async (req, res) => {
    try {
        const { data: shorts, fromCache } = await getCacheOrFetch(
            CACHE_KEYS.SHORTS_LIST,
            async () => {
                return await prisma.shortsVideo.findMany({
                    include: { authorUser: { select: { id: true, username: true, email: true } } },
                    orderBy: { createdAt: 'desc' }
                });
            },
            CACHE_TTL.SHORTS
        );

        res.status(200).json({ success: true, shorts, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching shorts', error: error.message });
    }
};

export const getShortById = async (req, res) => {
    try {
        const { id } = req.params;
        const cacheKey = `${CACHE_KEYS.SHORT}${id}`;

        const { data: short, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                return await prisma.shortsVideo.findUnique({
                    where: { id },
                    include: { authorUser: { select: { id: true, username: true, email: true } } }
                });
            },
            CACHE_TTL.SHORTS
        );

        if (!short) {
            return res.status(404).json({ success: false, message: 'Short not found' });
        }

        res.status(200).json({ success: true, short, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching short', error: error.message });
    }
};