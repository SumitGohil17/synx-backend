import Video from "../model/Video.js";
import { put } from '@vercel/blob';
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import AWS from "aws-sdk";
import { v4 as uuidv4 } from "uuid"; 

// const s3 = new AWS.S3({
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
//   region: process.env.AWS_REGION
// });

// const bucketName = process.env.S3_BUCKET_NAME;

const videoController = async (req, res) => {
    const { title, description, thumbnail, tags, category, author, duration, views, likes } = req.body;
    const inputPath = req.file.path;

    if (!inputPath) {
        return res.status(400).json({ error: 'Video file is required.' });
    }

    if (!title || !description) {
        return res.status(400).json({ error: 'Title, description, and video file are required.' });
    }

    try {
        // const uniqueFilename = `videos/${Date.now()}-${inputPath.originalname}`;

        // const blob = await put(uniqueFilename, inputPath.buffer, {
        //     access: 'public',
        //     token: process.env.BLOB_READ_WRITE_TOKEN,
        // });

        let parsedTags = [];
        if (tags) {
            parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        }

        // const videoId = uuidv4();
        // const outputDir = path.join("uploads", `hls_${videoId}`);
        // fs.mkdirSync(outputDir, { recursive: true });

        // // FFmpeg args
        // const ffmpegArgs = [
        //     "-i", inputPath,
        //     "-filter_complex",
        //     "[v:0]split=4[v1][v2][v3][v4];" +
        //     "[v1]scale=w=-2:h=360[v1out];" +
        //     "[v2]scale=w=-2:h=480[v2out];" +
        //     "[v3]scale=w=-2:h=720[v3out];" +
        //     "[v4]scale=w=-2:h=1080[v4out]",
        //     "-map", "[v1out]", "-c:v:0", "libx264", "-b:v:0", "800k",
        //     "-map", "[v2out]", "-c:v:1", "libx264", "-b:v:1", "1200k",
        //     "-map", "[v3out]", "-c:v:2", "libx264", "-b:v:2", "2500k",
        //     "-map", "[v4out]", "-c:v:3", "libx264", "-b:v:3", "5000k",
        //     "-map", "0:a:0", "-c:a:0", "aac", "-b:a:0", "128k", "-ac", "2",
        //     "-map", "0:a:0", "-c:a:1", "aac", "-b:a:1", "128k", "-ac", "2",
        //     "-map", "0:a:0", "-c:a:2", "aac", "-b:a:2", "128k", "-ac", "2",
        //     "-map", "0:a:0", "-c:a:3", "aac", "-b:a:3", "128k", "-ac", "2",
        //     "-f", "hls",
        //     "-hls_time", "6",
        //     "-hls_playlist_type", "vod",
        //     "-hls_segment_filename", `${outputDir}/v%v/segment_%03d.ts`,
        //     "-master_pl_name", "master.m3u8",
        //     "-var_stream_map", "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3",
        //     `${outputDir}/v%v/index.m3u8`
        // ];

        // // Run ffmpeg
        // await new Promise((resolve, reject) => {
        //     const ffmpeg = spawn("ffmpeg", ffmpegArgs);
        //     ffmpeg.stderr.on("data", (data) => console.log(data.toString()));
        //     ffmpeg.on("close", (code) => code === 0 ? resolve() : reject(new Error("FFmpeg failed")));
        // });

        // // Recursive S3 upload
        // const uploadFiles = async (dir, prefix = "") => {
        //     const files = fs.readdirSync(dir);
        //     for (const file of files) {
        //         const filePath = path.join(dir, file);
        //         const s3Key = path.join("hls", videoId, prefix, file).replace(/\\/g, "/");

        //         if (fs.statSync(filePath).isDirectory()) {
        //             await uploadFiles(filePath, path.join(prefix, file));
        //         } else {
        //             const fileBuffer = fs.readFileSync(filePath);
        //             await s3.putObject({
        //                 Bucket: bucketName,
        //                 Key: s3Key,
        //                 Body: fileBuffer,
        //                 ContentType: file.endsWith(".m3u8")
        //                     ? "application/vnd.apple.mpegurl"
        //                     : "video/mp2t"
        //             }).promise();
        //             console.log(`Uploaded ${s3Key}`);
        //         }
        //     }
        // };

        // await uploadFiles(outputDir);

        // // Cleanup
        // fs.unlinkSync(inputPath);
        // fs.rmSync(outputDir, { recursive: true, force: true });

        // // Final master playlist URL
        // const masterPlaylistKey = `hls/${videoId}/master.m3u8`;
        // const masterUrl = `https://s3.${process.env.AWS_REGION}.amazonaws.com/${bucketName}/${masterPlaylistKey}`;

        const data = await Video.create({
            title,
            url: inputPath,
            description,
            thumbnail,
            tags: parsedTags,
            category,
            author,
            fileSize: inputPath.size,
            mimeType: inputPath.mimetype
        });

        res.status(201).json({
            message: 'Video uploaded successfully',
            data: {
                id: data._id,
                title: data.title,
                url: data.url,
                description: data.description,
                thumbnail: data.thumbnail,
                tags: data.tags,
                category: data.category,
                author: data.author,
                fileSize: data.fileSize,
                mimeType: data.mimeType,
                createdAt: data.createdAt
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            error: 'Failed to upload video',
            details: error.message
        });
    }
}

const getAllVideos = async (req, res) => {
    try {
        const { page = 1, limit = 10, category, search } = req.query;

        const query = {};

        if (category) {
            query.category = category;
        }

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { tags: { $in: [new RegExp(search, 'i')] } }
            ];
        }

        const videos = await Video.find(query)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const total = await Video.countDocuments(query);

        res.status(200).json({
            success: true,
            data: videos,
            pagination: {
                current: parseInt(page),
                pages: Math.ceil(total / limit),
                total,
                limit: parseInt(limit)
            }
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

        const video = await Video.findById(id);

        if (!video) {
            return res.status(404).json({
                success: false,
                message: 'Video not found'
            });
        }

        res.status(200).json({
            success: true,
            data: video
        });
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
        const updates = req.body;

        const video = await Video.findByIdAndUpdate(
            id,
            updates,
            { new: true, runValidators: true }
        );

        if (!video) {
            return res.status(404).json({
                success: false,
                message: 'Video not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Video updated successfully',
            data: video
        });
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

        const video = await Video.findByIdAndDelete(id);

        if (!video) {
            return res.status(404).json({
                success: false,
                message: 'Video not found'
            });
        }

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

export {
    videoController,
    getAllVideos,
    getVideoById,
    updateVideo,
    deleteVideo
};