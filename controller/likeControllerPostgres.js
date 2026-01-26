import prisma from '../connection/prismaConnection.js';
import { 
    getCache, setCache, getCacheOrFetch,
    invalidateLikeCache,
    CACHE_KEYS, CACHE_TTL 
} from '../utils/cacheUtils.js';

export const likeVideo = async (req, res) => {
    try {
        const { supabaseId, videoId } = req.body;
        
        if (!supabaseId || !videoId) {
            return res.status(400).json({ success: false, message: 'supabaseId and videoId required' });
        }
        
        const userCacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${supabaseId}`;
        let user = await getCache(userCacheKey);
        
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId } });
            if (user) await setCache(userCacheKey, user, CACHE_TTL.USER);
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const existingLike = await prisma.videoLike.findUnique({
            where: { 
                uniqueUserVideoLike: { 
                    userId: user.id, 
                    videoId 
                } 
            }
        });
        
        if (existingLike) {
            return res.status(400).json({ success: false, message: 'Already liked' });
        }
        
        await prisma.videoLike.create({
            data: { userId: user.id, videoId }
        });
        
        await invalidateLikeCache(videoId, user.id);
        
        const likeCount = await prisma.videoLike.count({ where: { videoId } });
        
        res.status(201).json({ success: true, message: 'Liked', likeCount });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const unlikeVideo = async (req, res) => {
    try {
        const { supabaseId, videoId } = req.body;
        
        if (!supabaseId || !videoId) {
            return res.status(400).json({ success: false, message: 'supabaseId and videoId required' });
        }
        
        const userCacheKey = `${CACHE_KEYS.USER_BY_SUPABASE}${supabaseId}`;
        let user = await getCache(userCacheKey);
        
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId } });
            if (user) await setCache(userCacheKey, user, CACHE_TTL.USER);
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        await prisma.videoLike.delete({
            where: { 
                uniqueUserVideoLike: { 
                    userId: user.id, 
                    videoId 
                } 
            }
        });
        
        await invalidateLikeCache(videoId, user.id);
        
        const likeCount = await prisma.videoLike.count({ where: { videoId } });
        
        res.status(200).json({ success: true, message: 'Unliked', likeCount });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getLikeCount = async (req, res) => {
    try {
        const { videoId } = req.params;
        const cacheKey = `${CACHE_KEYS.LIKES_COUNT}${videoId}`;
        
        const { data: count, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => await prisma.videoLike.count({ where: { videoId } }),
            CACHE_TTL.LIKES
        );
        
        res.status(200).json({ success: true, count, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const checkLikeStatus = async (req, res) => {
    try {
        const { supabaseId, videoId } = req.query;
        
        if (!supabaseId || !videoId) {
            return res.status(200).json({ success: true, liked: false });
        }
        
        const cacheKey = `${CACHE_KEYS.LIKE_STATUS}${supabaseId}:${videoId}`;
        
        const { data, fromCache } = await getCacheOrFetch(
            cacheKey,
            async () => {
                const user = await prisma.user.findUnique({ where: { supabaseId } });
                if (!user) return { liked: false };
                
                const like = await prisma.videoLike.findUnique({
                    where: { uniqueUserVideoLike: { userId: user.id, videoId } }
                });
                return { liked: !!like };
            },
            CACHE_TTL.LIKE_STATUS
        );
        
        res.status(200).json({ success: true, ...data, cached: fromCache });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
