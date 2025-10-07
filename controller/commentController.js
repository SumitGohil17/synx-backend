import Comment from '../model/Comment.js';

// Add a comment to a video
export const addComment = async (req, res) => {
    try {
        const { videoId, userId, text } = req.body;
        if (!text || !videoId || !userId) return res.status(400).json({ success: false, message: 'Missing fields.' });
        const comment = await Comment.create({ video: videoId, user: userId, text });
        res.status(201).json({ success: true, comment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error adding comment.', error: error.message });
    }
};

// Get comments for a video
export const getComments = async (req, res) => {
    try {
        const { videoId } = req.params;
        const comments = await Comment.find({ video: videoId }).populate('user', 'username email');
        res.status(200).json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching comments.', error: error.message });
    }
};
