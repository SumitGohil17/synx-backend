import prisma from '../connection/prismaConnection.js';

export const likeVideo = async (req, res) => {
    try {
        const { videoId, userId } = req.body;
        
        const existing = await prisma.like.findUnique({
            where: {
                videoId_userId: {
                    videoId,
                    userId
                }
            }
        });
        
        if (existing) {
            return res.status(200).json({ success: false, message: 'Already liked.' });
        }
        
        await prisma.like.create({ data: { videoId, userId } });
        await prisma.video.update({
            where: { id: videoId },
            data: { likes: { increment: 1 } }
        });
        
        res.status(200).json({ success: true, message: 'Video liked.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error liking video.', error: error.message });
    }
};

export const unlikeVideo = async (req, res) => {
    try {
        const { videoId, userId } = req.body;
        
        const like = await prisma.like.findUnique({
            where: {
                videoId_userId: {
                    videoId,
                    userId
                }
            }
        });
        
        if (!like) {
            return res.status(404).json({ success: false, message: 'Like not found.' });
        }
        
        await prisma.like.delete({
            where: {
                videoId_userId: {
                    videoId,
                    userId
                }
            }
        });
        
        await prisma.video.update({
            where: { id: videoId },
            data: { likes: { decrement: 1 } }
        });
        
        res.status(200).json({ success: true, message: 'Video unliked.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error unliking video.', error: error.message });
    }
};
