import prisma from '../connection/prismaConnection.js';

export const addComment = async (req, res) => {
    try {
        const { videoId, supabaseId, text } = req.body;
        
        if (!text || !videoId || !supabaseId) {
            return res.status(400).json({ success: false, message: 'Missing fields.' });
        }
        
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found. Please sync user first.' });
        }

        const video = await prisma.video.findUnique({ where: { id: videoId } });
        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found.' });
        }



        const comment = await prisma.comment.create({
            data: { videoId, userId: user.id, text },
            include: { user: { select: { username: true, email: true } } }
        });
        
        res.status(201).json({ success: true, comment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error adding comment.', error: error.message });
    }
};

export const getComments = async (req, res) => {
    try {
        const { videoId } = req.params;
        const comments = await prisma.comment.findMany({
            where: { videoId },
            include: { user: { select: { id: true, username: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        
        res.status(200).json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching comments.', error: error.message });
    }
};
