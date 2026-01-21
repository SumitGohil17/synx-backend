import prisma from '../connection/prismaConnection.js';
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


        if (!inputPath) {
            return res.status(400).json({ success: false, message: 'Video file is required' });
        }
        if (!title || !authorId) {
            return res.status(400).json({ success: false, message: 'title, videoUrl, and userId are required' });
        }
        const user = await prisma.user.findUnique({ where: { supabaseId: authorId } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found. Please sync user first.' });
        }

        // let parsedTags = [];
        // if (tags) {
        //     try {
        //         parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        //         if (!Array.isArray(parsedTags)) parsedTags = [parsedTags];
        //     } catch {
        //         parsedTags = tags.split(',').map(t => t.trim());
        //     }
        // }
        const short = await prisma.shortsVideo.create({
            data: { title: title, description: description, url: inputPath2, tags: parsedTags, category: category, author: authorName, authorId: user.id },
            include: { authorUser: { select: { id: true, username: true, email: true } } }
        });
        res.status(201).json({ success: true, short });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating short', error: error.message });
    }
};

export const getShorts = async (req, res) => {
    try {
        const shorts = await prisma.shortsVideo.findMany({
            include: { authorUser: { select: { id: true, username: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, shorts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching shorts', error: error.message });
    }
};
export const getShortById = async (req, res) => {
    try {
        const { id } = req.params;
        const short = await prisma.shortsVideo.findUnique({
            where: { id },
            include: { authorUser: { select: { id: true, username: true, email: true } } }
        });
        if (!short) {
            return res.status(404).json({ success: false, message: 'Short not found' });
        }
        res.status(200).json({ success: true, short });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching short', error: error.message });
    }
};