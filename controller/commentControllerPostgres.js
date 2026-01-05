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
        // Only fetch top-level comments (no parentId) with their replies
        const comments = await prisma.comment.findMany({
            where: { videoId, parentId: null },
            include: {
                user: { select: { id: true, username: true, email: true } },
                replies: {
                    include: { user: { select: { id: true, username: true, email: true } } },
                    orderBy: { createdAt: 'desc' }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        
        res.status(200).json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching comments.', error: error.message });
    }
};

//reply on te comment
export const addReply = async (req, res) => {
    try {
        const { commentId, supabaseId, text } = req.body;
        if (!text || !commentId || !supabaseId) {
            return res.status(400).json({ success: false, message: 'Missing fields.' });
        }
        const user = await prisma.user.findUnique({ where: { supabaseId } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found. Please sync user first.' });
        }
        const parentComment = await prisma.comment.findUnique({ where: { id: commentId } });
        if (!parentComment) {
            return res.status(404).json({ success: false, message: 'Comment not found.' });
        }
        const reply = await prisma.comment.create({
            data: { 
                videoId: parentComment.videoId,
                userId: user.id, 
                text,
                parentId: commentId
            },
            include: { user: { select: { username: true, email: true } } }
        });
        res.status(201).json({ success: true, reply });
    }
    catch (error) {
        res.status(500).json({ success: false, message: 'Error adding reply.', error: error.message });
    }
};
export const getReplies = async (req, res) => {
    try {
        const { commentId } = req.params;
        const replies = await prisma.comment.findMany({
            where: { parentId: commentId },
            include: { user: { select: { id: true, username: true, email: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, replies });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching replies.', error: error.message });
    }    
};


        
