import prisma from '../connection/prismaConnection.js';

export const setupVideoRoomSocket = (io) => {
    // Namespace for video rooms
    const roomNamespace = io.of('/video-rooms');

    roomNamespace.on('connection', (socket) => {
        console.log(`User connected to video rooms: ${socket.id}`);

        // Join a room
        socket.on('join-room', async ({ roomCode, userId, username }) => {
            try {
                const room = await prisma.videoRoom.findUnique({
                    where: { roomCode },
                    include: {
                        video: true,
                        participants: {
                            include: { user: { select: { id: true, username: true } } }
                        }
                    }
                });

                if (!room) {
                    socket.emit('error', { message: 'Room not found' });
                    return;
                }

                // Join socket room
                socket.join(roomCode);
                socket.data.roomCode = roomCode;
                socket.data.userId = userId;
                socket.data.username = username;

                // Update participant socket ID and online status
                await prisma.roomParticipant.updateMany({
                    where: { roomId: room.id, userId },
                    data: { socketId: socket.id, isOnline: true, lastSeen: new Date() }
                });

                // Get updated participants list
                const participants = await prisma.roomParticipant.findMany({
                    where: { roomId: room.id, isOnline: true },
                    include: { user: { select: { id: true, username: true, email: true } } }
                });

                // Notify room that user joined
                roomNamespace.to(roomCode).emit('user-joined', {
                    userId,
                    username,
                    participants: participants.map(p => ({
                        id: p.user.id,
                        username: p.user.username,
                        isOnline: p.isOnline
                    }))
                });

                // Send system message
                const systemMessage = await prisma.roomMessage.create({
                    data: {
                        roomId: room.id,
                        userId,
                        message: `${username} joined the room`,
                        messageType: 'system'
                    },
                    include: { user: { select: { id: true, username: true } } }
                });

                roomNamespace.to(roomCode).emit('new-message', systemMessage);

                console.log(`User ${username} joined room ${roomCode}`);
            } catch (error) {
                console.error('Join room error:', error);
                socket.emit('error', { message: 'Failed to join room' });
            }
        });

        // Send chat message
        socket.on('send-message', async ({ roomCode, userId, message }) => {
            try {
                const room = await prisma.videoRoom.findUnique({ where: { roomCode } });
                if (!room) return;

                const newMessage = await prisma.roomMessage.create({
                    data: {
                        roomId: room.id,
                        userId,
                        message,
                        messageType: 'text'
                    },
                    include: { user: { select: { id: true, username: true, email: true } } }
                });

                // Broadcast message to all in room
                roomNamespace.to(roomCode).emit('new-message', newMessage);
            } catch (error) {
                console.error('Send message error:', error);
            }
        });

        // Share timestamp
        socket.on('share-timestamp', async ({ roomCode, userId, timestamp, targetUserId }) => {
            try {
                const room = await prisma.videoRoom.findUnique({ where: { roomCode } });
                if (!room) return;

                const user = await prisma.user.findUnique({ where: { id: userId } });

                const timestampMessage = await prisma.roomMessage.create({
                    data: {
                        roomId: room.id,
                        userId,
                        message: targetUserId 
                            ? `shared a timestamp with someone` 
                            : `shared timestamp: ${formatTime(timestamp)}`,
                        messageType: 'timestamp',
                        timestamp,
                        targetUserId
                    },
                    include: { user: { select: { id: true, username: true } } }
                });

                if (targetUserId) {
                    // Send to specific user
                    const targetParticipant = await prisma.roomParticipant.findFirst({
                        where: { roomId: room.id, userId: targetUserId }
                    });

                    if (targetParticipant?.socketId) {
                        roomNamespace.to(targetParticipant.socketId).emit('timestamp-shared', {
                            from: user.username,
                            timestamp,
                            message: timestampMessage
                        });
                    }
                } else {
                    // Broadcast to everyone
                    roomNamespace.to(roomCode).emit('timestamp-shared', {
                        from: user.username,
                        timestamp,
                        message: timestampMessage
                    });
                }
            } catch (error) {
                console.error('Share timestamp error:', error);
            }
        });

        // Sync video playback (play/pause)
        socket.on('video-control', ({ roomCode, action, currentTime }) => {
            socket.to(roomCode).emit('video-control', {
                action, // 'play' or 'pause'
                currentTime,
                from: socket.data.username
            });
        });

        // Sync video seek
        socket.on('video-seek', ({ roomCode, currentTime }) => {
            socket.to(roomCode).emit('video-seek', {
                currentTime,
                from: socket.data.username
            });
        });

        // User typing indicator
        socket.on('typing', ({ roomCode }) => {
            socket.to(roomCode).emit('user-typing', {
                username: socket.data.username,
                userId: socket.data.userId
            });
        });

        // Leave room
        socket.on('leave-room', async ({ roomCode, userId }) => {
            try {
                const room = await prisma.videoRoom.findUnique({ where: { roomCode } });
                if (!room) return;

                // Update participant status
                await prisma.roomParticipant.updateMany({
                    where: { roomId: room.id, userId },
                    data: { isOnline: false, lastSeen: new Date() }
                });

                socket.leave(roomCode);

                // Notify others
                const user = await prisma.user.findUnique({ where: { id: userId } });
                roomNamespace.to(roomCode).emit('user-left', {
                    userId,
                    username: user?.username
                });

                // System message
                await prisma.roomMessage.create({
                    data: {
                        roomId: room.id,
                        userId,
                        message: `${user?.username} left the room`,
                        messageType: 'system'
                    }
                });
            } catch (error) {
                console.error('Leave room error:', error);
            }
        });

        // Disconnect
        socket.on('disconnect', async () => {
            try {
                const { roomCode, userId } = socket.data;
                if (roomCode && userId) {
                    const room = await prisma.videoRoom.findUnique({ where: { roomCode } });
                    if (room) {
                        await prisma.roomParticipant.updateMany({
                            where: { roomId: room.id, userId },
                            data: { isOnline: false, lastSeen: new Date(), socketId: null }
                        });

                        const user = await prisma.user.findUnique({ where: { id: userId } });
                        roomNamespace.to(roomCode).emit('user-left', {
                            userId,
                            username: user?.username
                        });
                    }
                }
                console.log(`User disconnected: ${socket.id}`);
            } catch (error) {
                console.error('Disconnect error:', error);
            }
        });
    });
};

// Helper function to format seconds to MM:SS
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}
