import express from 'express';
import {
    addWatchHistory,
    getUserWatchHistory,
    getWatchHistoryEntry,
    getWatchStatistics,
    getContinueWatching,
    getWatchItAgain,
    removeFromWatchHistory,
    pauseWatchHistory,
    searchWatchHistory
} from '../controller/watchHistoryController.js';

const router = express.Router();

router.post('/', addWatchHistory);

router.get('/user/:userId', getUserWatchHistory);

router.get('/user/:userId/continue-watching', getContinueWatching);

router.get('/user/:userId/watch-it-again', getWatchItAgain);
router.get('/user/:userId/search', searchWatchHistory);
router.get('/user/:userId/video/:videoId', getWatchHistoryEntry);



router.post('/user/:userId/remove', removeFromWatchHistory);

router.get('/user/:userId/statistics', getWatchStatistics);

router.post('/user/:userId/pause', pauseWatchHistory);

export default router;
