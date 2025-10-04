import express from 'express';
// import upload from '../middleware/upload.js';
import multer from 'multer';
import { validateVideoUpload, validateVideoUpdate } from '../middleware/validation.js';
import { 
    videoController,
    getAllVideos,
    getVideoById,
    updateVideo,
    deleteVideo
} from '../controller/videoController.js';

const Router = express.Router();

const upload = multer({ dest: "uploads/" });


Router.post('/upload', 
    upload.single('video'), 
    validateVideoUpload,
    videoController
);

// Router.post('/upload-any', 
//     upload.any(),
//     (req, res, next) => {
//         if (req.files && req.files.length > 0) {
//             req.file = req.files[0];
//         }
//         next();
//     },
//     validateVideoUpload,
//     videoController
// );

Router.post('/debug', 
    upload.any(),
    (req, res) => {
        res.json({
            body: req.body,
            files: req.files,
            headers: req.headers
        });
    }
);

Router.get('/allvideo', getAllVideos);

Router.get('/:id', getVideoById);

Router.put('/:id', validateVideoUpdate, updateVideo);

Router.delete('/:id', deleteVideo);

export default Router;
