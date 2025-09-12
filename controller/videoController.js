import Video from "../model/Video.js";
import { put } from '@vercel/blob';

const videoController = async (req, res) => {
    const { title, description, thumbnail, tags, category, author, duration, views, likes } = req.body;
    const videoFile = req.file;

    if (!videoFile) {
        return res.status(400).json({ error: 'Video file is required.' });
    }
    
    if (!title || !description) {
        return res.status(400).json({ error: 'Title, description, and video file are required.' });
    }

    try {
        const uniqueFilename = `videos/${Date.now()}-${videoFile.originalname}`;
        
        const blob = await put(uniqueFilename, videoFile.buffer, {
            access: 'public',
            token: process.env.BLOB_READ_WRITE_TOKEN,
        });

        let parsedTags = [];
        if (tags) {
            parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
        }

        const data = await Video.create({
            title,
            url: blob.url, 
            description,
            thumbnail,
            tags: parsedTags,
            category,
            author,
            fileSize: videoFile.size,
            mimeType: videoFile.mimetype
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