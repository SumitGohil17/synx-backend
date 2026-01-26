import prisma from '../connection/prismaConnection.js';
import { 
    getCache, setCache, getCacheOrFetch,
    invalidateCommentCache, invalidateReplyCache,
    CACHE_KEYS, CACHE_TTL 
} from '../utils/cacheUtils.js';

export const addComment = async (req, res) => {
    try {
        const { videoId, supabaseId, text } = req.body;
        
        if (!text || !videoId || !supabaseId) {
            return res.status(400).json({ success: false, message: 'Missing fields.' });
        }
        
        const userCacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${supabaseId}`;
        let user = await getCache(userCacheKey);
        
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId } });
            if (user) {
                await setCache(userCacheKey, user, CACHE_TTL.USER);
            }
        }
        
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
        
        await invalidateCommentCache(videoId);
        
        res.status(201).json({ success: true, comment });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error adding comment.', error: error.message });
    }
};

export const getComments = async (req, res) => {
    try {
        const { videoId } = req.params;
        const cacheKey = `${CACHE_KEYS.COMMENTS}${videoId}`;
        
        const { data: comments, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                return await prisma.comment.findMany({
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
            },
            CACHE_TTL.COMMENTS
        );
        
        res.status(200).json({ success: true, comments, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching comments.', error: error.message });
    }
};

export const addReply = async (req, res) => {
    try {
        const { commentId, supabaseId, text } = req.body;
        if (!text || !commentId || !supabaseId) {
            return res.status(400).json({ success: false, message: 'Missing fields.' });
        }
        
        const userCacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${supabaseId}`;
        let user = await getCache(userCacheKey);
        
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId } });
            if (user) await setCache(userCacheKey, user, CACHE_TTL.USER);
        }
        
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
        
        await invalidateCommentCache(parentComment.videoId);
        await invalidateReplyCache(commentId);
        
        res.status(201).json({ success: true, reply });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error adding reply.', error: error.message });
    }
};

export const getReplies = async (req, res) => {
    try {
        const { commentId } = req.params;
        const cacheKey = `${CACHE_KEYS.REPLIES}${commentId}`;
        
        const { data: replies, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                return await prisma.comment.findMany({
                    where: { parentId: commentId },
                    include: { user: { select: { id: true, username: true, email: true } } },
                    orderBy: { createdAt: 'desc' }
                });
            },
            CACHE_TTL.REPLIES
        );
        
        res.status(200).json({ success: true, replies, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching replies.', error: error.message });
    }    
};



