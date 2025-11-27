import express from 'express';
import { addComment, getComments } from '../controller/commentControllerPostgres.js';

const router = express.Router();

router.post('/add', addComment);
router.get('/:videoId', getComments);

export default router;
