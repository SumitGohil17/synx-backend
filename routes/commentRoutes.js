import express from 'express';
import { addComment, getComments, addReply, getReplies } from '../controller/commentControllerPostgres.js';

const router = express.Router();

router.post('/add', addComment);
router.get('/:videoId', getComments);

// Reply routes
router.post('/reply', addReply);
router.get('/replies/:commentId', getReplies);

export default router;
