import express from 'express';
import {
    createRoom,
    joinRoom,
    getRoomByCode,
    closeRoom,
    getRoomMessages
} from '../controller/videoRoomController.js';

const router = express.Router();

router.post('/create', createRoom);
router.post('/join', joinRoom);
router.get('/:roomCode', getRoomByCode);
router.post('/close', closeRoom);
router.get('/:roomId/messages', getRoomMessages);

export default router;
