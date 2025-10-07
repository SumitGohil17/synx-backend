import Like from '../model/Like.js';
import Video from '../model/Video.js';

// Like a video
export const likeVideo = async (req, res) => {
    try {
        const { videoId, userId } = req.body;
        // Prevent duplicate likes
        const existing = await Like.findOne({ video: videoId, user: userId });
        if (existing) return res.status(200).json({ success: false, message: 'Already liked.' });
        await Like.create({ video: videoId, user: userId });
        await Video.findByIdAndUpdate(videoId, { $inc: { likes: 1 } });
        res.status(200).json({ success: true, message: 'Video liked.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error liking video.', error: error.message });
    }
};

// Unlike a video
export const unlikeVideo = async (req, res) => {
    try {
        const { videoId, userId } = req.body;
        const like = await Like.findOneAndDelete({ video: videoId, user: userId });
        if (!like) return res.status(404).json({ success: false, message: 'Like not found.' });
        await Video.findByIdAndUpdate(videoId, { $inc: { likes: -1 } });
        res.status(200).json({ success: true, message: 'Video unliked.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error unliking video.', error: error.message });
    }
};
