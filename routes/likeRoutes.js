import express from 'express';
import { likeVideo, unlikeVideo } from '../controller/likeControllerPostgres.js';

const router = express.Router();

router.post('/like', likeVideo);
router.post('/unlike', unlikeVideo);

export default router;
