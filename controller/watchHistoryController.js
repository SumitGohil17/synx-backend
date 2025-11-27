import prisma from '../connection/prismaConnection.js';

// Add or update watch history (YouTube-style)
export const addWatchHistory = async (req, res) => {
    try {
        const { userId, videoId, watchDuration, lastPosition, completed } = req.body;

        if (!userId || !videoId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId and videoId are required' 
            });
        }

        // Verify user exists - check by id first, then by supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        
        // If not found by id, try finding by supabaseId
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        // Use the actual database user id for watch history
        const actualUserId = user.id;

        // Verify video exists
        const video = await prisma.video.findUnique({ where: { id: videoId } });
        if (!video) {
            return res.status(404).json({ 
                success: false, 
                message: 'Video not found' 
            });
        }

        // YouTube-style logic: Only add to history if watched for at least 1 second
        const minimumWatchTime = 1; // seconds
        if (watchDuration < minimumWatchTime && !completed) {
            return res.status(200).json({ 
                success: true, 
                message: 'Watch time too short to record',
                minimumRequired: minimumWatchTime
            });
        }

        // Auto-mark as completed if watched >= 90% of video
        const autoCompleteThreshold = 0.9;
        let isCompleted = completed || false;
        if (video.duration && lastPosition >= video.duration * autoCompleteThreshold) {
            isCompleted = true;
        }

        // Upsert watch history (create or update)
        // YouTube always updates timestamp to keep it fresh at the top
        const watchHistory = await prisma.watchHistory.upsert({
            where: {
                userId_videoId: {
                    userId: actualUserId,
                    videoId
                }
            },
            update: {
                watchedAt: new Date(), // Always update timestamp (YouTube behavior)
                watchDuration: watchDuration || 0,
                lastPosition: lastPosition || 0,
                completed: isCompleted
            },
            create: {
                userId: actualUserId,
                videoId,
                watchDuration: watchDuration || 0,
                lastPosition: lastPosition || 0,
                completed: isCompleted
            },
            include: {
                video: {
                    select: {
                        id: true,
                        title: true,
                        thumbnail: true,
                        duration: true,
                        views: true,
                        authorId: true,
                        author: true,
                        createdAt: true
                    }
                }
            }
        });

        res.status(200).json({ 
            success: true, 
            message: 'Watch history updated',
            watchHistory 
        });
    } catch (error) {
        console.error('Add watch history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating watch history', 
            error: error.message 
        });
    }
};

// Get user's watch history
export const getUserWatchHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 50, offset = 0 } = req.query;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        // Get watch history with video details
        const watchHistory = await prisma.watchHistory.findMany({
            where: { userId: actualUserId },
            include: {
                video: {
                    include: {
                        authorUser: {
                            select: {
                                id: true,
                                username: true,
                                email: true
                            }
                        },
                        comments: {
                            select: { id: true }
                        },
                        videoLikes: {
                            select: { id: true }
                        }
                    }
                }
            },
            orderBy: { watchedAt: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset)
        });


        const formattedHistory = watchHistory.map(item => ({
            id: item.id,
            watchedAt: item.watchedAt,
            watchDuration: item.watchDuration,
            lastPosition: item.lastPosition,
            completed: item.completed,
            progressPercentage: item.video.duration > 0 
                ? Math.round((item.lastPosition / item.video.duration) * 100) 
                : 0,
            video: {
                ...item.video,
                commentsCount: item.video.comments.length,
                likesCount: item.video.videoLikes.length
            }
        }));


        const totalCount = await prisma.watchHistory.count({
            where: { userId: actualUserId }
        });

        res.status(200).json({ 
            success: true, 
            watchHistory: formattedHistory,
            pagination: {
                total: totalCount,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(offset) + parseInt(limit) < totalCount
            }
        });
    } catch (error) {
        console.error('Get watch history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching watch history', 
            error: error.message 
        });
    }
};

export const getWatchHistoryEntry = async (req, res) => {
    try {
        const { userId, videoId } = req.params;

        if (!userId || !videoId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId and videoId are required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        const watchHistory = await prisma.watchHistory.findUnique({
            where: {
                userId_videoId: {
                    userId: actualUserId,
                    videoId
                }
            },
            include: {
                video: {
                    select: {
                        id: true,
                        title: true,
                        thumbnail: true,
                        duration: true,
                        views: true,
                        author: true,
                        createdAt: true
                    }
                }
            }
        });

        if (!watchHistory) {
            return res.status(404).json({ 
                success: false, 
                message: 'Watch history not found' 
            });
        }

        res.status(200).json({ 
            success: true, 
            watchHistory 
        });
    } catch (error) {
        console.error('Get watch history entry error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching watch history', 
            error: error.message 
        });
    }
};



export const getWatchStatistics = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        const totalWatched = await prisma.watchHistory.count({
            where: { userId: actualUserId }
        });

        const watchTimeResult = await prisma.watchHistory.aggregate({
            where: { userId: actualUserId },
            _sum: {
                watchDuration: true
            }
        });

        const completedCount = await prisma.watchHistory.count({
            where: { 
                userId: actualUserId,
                completed: true 
            }
        });

        const recentHistory = await prisma.watchHistory.findMany({
            where: { userId: actualUserId },
            include: {
                video: {
                    select: {
                        category: true
                    }
                }
            },
            take: 100
        });

        const categoryStats = recentHistory.reduce((acc, item) => {
            const category = item.video.category || 'Uncategorized';
            acc[category] = (acc[category] || 0) + 1;
            return acc;
        }, {});

        const totalWatchTime = watchTimeResult._sum.watchDuration || 0;
        const avgWatchTime = totalWatched > 0 ? Math.round(totalWatchTime / totalWatched) : 0;

        res.status(200).json({ 
            success: true, 
            statistics: {
                totalVideosWatched: totalWatched,
                totalWatchTimeSeconds: totalWatchTime,
                totalWatchTimeFormatted: formatDuration(totalWatchTime),
                averageWatchTimeSeconds: avgWatchTime,
                averageWatchTimeFormatted: formatDuration(avgWatchTime),
                completedVideos: completedCount,
                completionRate: totalWatched > 0 
                    ? Math.round((completedCount / totalWatched) * 100) 
                    : 0,
                topCategories: Object.entries(categoryStats)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([category, count]) => ({ category, count }))
            }
        });
    } catch (error) {
        console.error('Get watch statistics error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching watch statistics', 
            error: error.message 
        });
    }
};

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

export const getContinueWatching = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 20 } = req.query;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        const continueWatching = await prisma.watchHistory.findMany({
            where: {
                userId: actualUserId,
                completed: false,
                lastPosition: {
                    gt: 0 
                }
            },
            include: {
                video: {
                    include: {
                        authorUser: {
                            select: {
                                id: true,
                                username: true,
                                email: true
                            }
                        },
                        comments: {
                            select: { id: true }
                        },
                        videoLikes: {
                            select: { id: true }
                        }
                    }
                }
            },
            orderBy: { watchedAt: 'desc' }, 
            take: parseInt(limit)
        });

        const filteredResults = continueWatching
            .map(item => {
                const progressPercentage = item.video.duration > 0 
                    ? Math.round((item.lastPosition / item.video.duration) * 100) 
                    : 0;
                
                return {
                    id: item.id,
                    watchedAt: item.watchedAt,
                    watchDuration: item.watchDuration,
                    lastPosition: item.lastPosition,
                    progressPercentage,
                    timeRemaining: item.video.duration - item.lastPosition,
                    video: {
                        ...item.video,
                        commentsCount: item.video.comments.length,
                        likesCount: item.video.videoLikes.length
                    }
                };
            })
            .filter(item => item.progressPercentage >= 5 && item.progressPercentage <= 95);

        res.status(200).json({ 
            success: true,
            continueWatching: filteredResults,
            count: filteredResults.length
        });
    } catch (error) {
        console.error('Get continue watching error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching continue watching videos', 
            error: error.message 
        });
    }
};

export const getWatchItAgain = async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 20 } = req.query;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        // Get completed videos
        const watchItAgain = await prisma.watchHistory.findMany({
            where: {
                userId: actualUserId,
                completed: true
            },
            include: {
                video: {
                    include: {
                        authorUser: {
                            select: {
                                id: true,
                                username: true,
                                email: true
                            }
                        },
                        comments: {
                            select: { id: true }
                        },
                        videoLikes: {
                            select: { id: true }
                        }
                    }
                }
            },
            orderBy: { watchedAt: 'desc' },
            take: parseInt(limit)
        });

        const formattedResults = watchItAgain.map(item => ({
            id: item.id,
            watchedAt: item.watchedAt,
            completedDate: item.watchedAt,
            video: {
                ...item.video,
                commentsCount: item.video.comments.length,
                likesCount: item.video.videoLikes.length
            }
        }));

        res.status(200).json({ 
            success: true,
            watchItAgain: formattedResults,
            count: formattedResults.length
        });
    } catch (error) {
        console.error('Get watch it again error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching completed videos', 
            error: error.message 
        });
    }
};

export const removeFromWatchHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const { videoId, timeRange } = req.body;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        let result;

        if (videoId) {

            result = await prisma.watchHistory.delete({
                where: {
                    userId_videoId: {
                        userId: actualUserId,
                        videoId
                    }
                }
            });
            return res.status(200).json({ 
                success: true, 
                message: 'Video removed from watch history' 
            });
        } else if (timeRange) {
            // Remove by time range (YouTube feature)
            const now = new Date();
            let startDate;

            switch (timeRange) {
                case 'today':
                    startDate = new Date(now.setHours(0, 0, 0, 0));
                    break;
                case 'yesterday':
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    startDate = new Date(yesterday.setHours(0, 0, 0, 0));
                    const endDate = new Date(yesterday.setHours(23, 59, 59, 999));
                    result = await prisma.watchHistory.deleteMany({
                        where: {
                            userId: actualUserId,
                            watchedAt: {
                                gte: startDate,
                                lte: endDate
                            }
                        }
                    });
                    break;
                case 'last7days':
                    startDate = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'last30days':
                    startDate = new Date(now.setDate(now.getDate() - 30));
                    break;
                case 'last90days':
                    startDate = new Date(now.setDate(now.getDate() - 90));
                    break;
                case 'alltime':
                    result = await prisma.watchHistory.deleteMany({
                        where: { userId: actualUserId }
                    });
                    return res.status(200).json({ 
                        success: true, 
                        message: `Cleared ${result.count} watch history entries`,
                        count: result.count
                    });
                default:
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Invalid time range' 
                    });
            }

            if (timeRange !== 'yesterday') {
                result = await prisma.watchHistory.deleteMany({
                    where: {
                        userId: actualUserId,
                        watchedAt: {
                            gte: startDate
                        }
                    }
                });
            }

            return res.status(200).json({ 
                success: true, 
                message: `Cleared ${result.count} watch history entries from ${timeRange}`,
                count: result.count,
                timeRange
            });
        } else {
            return res.status(400).json({ 
                success: false, 
                message: 'Either videoId or timeRange must be provided' 
            });
        }
    } catch (error) {
        console.error('Remove from watch history error:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ 
                success: false, 
                message: 'Watch history entry not found' 
            });
        }
        res.status(500).json({ 
            success: false, 
            message: 'Error removing from watch history', 
            error: error.message 
        });
    }
};

export const pauseWatchHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const { paused } = req.body;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: paused ? 'Watch history paused' : 'Watch history resumed',
            isPaused: paused,
            note: 'Implement UserSettings model to persist this preference'
        });
    } catch (error) {
        console.error('Pause watch history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating watch history settings', 
            error: error.message 
        });
    }
};

// YouTube-style: Search Watch History
export const searchWatchHistory = async (req, res) => {
    try {
        const { userId } = req.params;
        const { query, limit = 50 } = req.query;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        if (!query) {
            return res.status(400).json({ 
                success: false, 
                message: 'Search query is required' 
            });
        }

        // Find user by id or supabaseId
        let user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            user = await prisma.user.findUnique({ where: { supabaseId: userId } });
        }
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        const actualUserId = user.id;

        // Search in watch history by video title, description, or author
        const searchResults = await prisma.watchHistory.findMany({
            where: {
                userId: actualUserId,
                video: {
                    OR: [
                        {
                            title: {
                                contains: query,
                                mode: 'insensitive'
                            }
                        },
                        {
                            description: {
                                contains: query,
                                mode: 'insensitive'
                            }
                        },
                        {
                            author: {
                                contains: query,
                                mode: 'insensitive'
                            }
                        },
                        {
                            category: {
                                contains: query,
                                mode: 'insensitive'
                            }
                        }
                    ]
                }
            },
            include: {
                video: {
                    include: {
                        authorUser: {
                            select: {
                                id: true,
                                username: true,
                                email: true
                            }
                        }
                    }
                }
            },
            orderBy: { watchedAt: 'desc' },
            take: parseInt(limit)
        });

        const formattedResults = searchResults.map(item => ({
            id: item.id,
            watchedAt: item.watchedAt,
            watchDuration: item.watchDuration,
            lastPosition: item.lastPosition,
            completed: item.completed,
            progressPercentage: item.video.duration > 0 
                ? Math.round((item.lastPosition / item.video.duration) * 100) 
                : 0,
            video: item.video
        }));

        res.status(200).json({ 
            success: true,
            searchResults: formattedResults,
            count: formattedResults.length,
            query
        });
    } catch (error) {
        console.error('Search watch history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error searching watch history', 
            error: error.message 
        });
    }
};

