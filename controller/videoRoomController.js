import prisma from '../connection/prismaConnection.js';
import crypto from 'crypto';

function generateRoomCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

export const createRoom = async (req, res) => {
    try {
        const { videoId, hostId, name } = req.body;

        if (!videoId || !hostId) {
            return res.status(400).json({ success: false, message: 'videoId and hostId are required' });
        }

        const video = await prisma.video.findUnique({ where: { id: videoId } });
        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        const host = await prisma.user.findUnique({ where: { id: hostId } });
        if (!host) {
            return res.status(404).json({ success: false, message: 'Host user not found. Please sync user first.' });
        }

        let roomCode;
        let isUnique = false;
        while (!isUnique) {
            roomCode = generateRoomCode();
            const existing = await prisma.videoRoom.findUnique({ where: { roomCode } });
            if (!existing) isUnique = true;
        }

        const room = await prisma.videoRoom.create({
            data: {
                videoId,
                hostId,
                roomCode,
                name: name || `${video.title} Watch Party`,
                isActive: true
            },
            include: {
                video: { select: { id: true, title: true, url: true, thumbnail: true } },
                host: { select: { id: true, username: true, email: true } }
            }
        });

        await prisma.roomParticipant.create({
            data: {
                roomId: room.id,
                userId: hostId,
                isOnline: true
            }
        });

        res.status(201).json({ success: true, room });
    } catch (error) {
        console.error('Create room error:', error);
        res.status(500).json({ success: false, message: 'Error creating room', error: error.message });
    }
};

export const joinRoom = async (req, res) => {
    try {
        const { roomCode, userId } = req.body;

        if (!roomCode || !userId) {
            return res.status(400).json({ success: false, message: 'roomCode and userId are required' });
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found. Please sync user first.' });
        }

        const room = await prisma.videoRoom.findUnique({
            where: { roomCode },
            include: {
                video: { select: { id: true, title: true, url: true, thumbnail: true, duration: true } },
                host: { select: { id: true, username: true, email: true } },
                participants: {
                    include: {
                        user: { select: { id: true, username: true, email: true } }
                    }
                }
            }
        });

        if (!room) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        if (!room.isActive) {
            return res.status(400).json({ success: false, message: 'Room is closed' });
        }

        const existingParticipant = await prisma.roomParticipant.findUnique({
            where: {
                roomId_userId: {
                    roomId: room.id,
                    userId
                }
            }
        });

        if (!existingParticipant) {
            await prisma.roomParticipant.create({
                data: {
                    roomId: room.id,
                    userId,
                    isOnline: true
                }
            });
        } else {
            await prisma.roomParticipant.update({
                where: { id: existingParticipant.id },
                data: { isOnline: true, lastSeen: new Date() }
            });
        }

        const messages = await prisma.roomMessage.findMany({
            where: { roomId: room.id },
            include: {
                user: { select: { id: true, username: true, email: true } }
            },
            orderBy: { createdAt: 'asc' },
        });

        res.status(200).json({ success: true, room, messages });
    } catch (error) {
        console.error('Join room error:', error);
        res.status(500).json({ success: false, message: 'Error joining room', error: error.message });
    }
};

export const getRoomByCode = async (req, res) => {
    try {
        const { roomCode } = req.params;

        const room = await prisma.videoRoom.findUnique({
            where: { roomCode },
            include: {
                video: true,
                host: { select: { id: true, username: true, email: true } },
                participants: {
                    include: {
                        user: { select: { id: true, username: true, email: true } }
                    },
                    where: { isOnline: true }
                }
            }
        });

        if (!room) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        res.status(200).json({ success: true, room });
    } catch (error) {
        console.error('Get room error:', error);
        res.status(500).json({ success: false, message: 'Error fetching room', error: error.message });
    }
};

export const closeRoom = async (req, res) => {
    try {
        const { roomId, userId } = req.body;

        const room = await prisma.videoRoom.findUnique({ where: { id: roomId } });

        if (!room) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        if (room.hostId !== userId) {
            return res.status(403).json({ success: false, message: 'Only host can close the room' });
        }

        await prisma.videoRoom.update({
            where: { id: roomId },
            data: { isActive: false }
        });

        res.status(200).json({ success: true, message: 'Room closed' });
    } catch (error) {
        console.error('Close room error:', error);
        res.status(500).json({ success: false, message: 'Error closing room', error: error.message });
    }
};

export const getRoomMessages = async (req, res) => {
    try {
        const { roomId } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        const messages = await prisma.roomMessage.findMany({
            where: { roomId },
            include: {
                user: { select: { id: true, username: true, email: true } }
            },
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset)
        });

        res.status(200).json({ success: true, messages: messages.reverse() });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: 'Error fetching messages', error: error.message });
    }
};
