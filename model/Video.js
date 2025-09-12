import mongoose from 'mongoose';
const { Schema } = mongoose;

const videoSchema = new Schema({
    title: {
        type: String,
        required: [true, 'Title is required'],
        trim: true,
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    url: {
        type: String,
        required: [true, 'Video URL is required']
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true,
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    thumbnail: {
        type: String,
        default: null
    },
    tags: {
        type: [String],
        default: [],
        validate: {
            validator: function(v) {
                return v.length <= 10;
            },
            message: 'Maximum 10 tags allowed'
        }
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: ['entertainment', 'education', 'music', 'sports', 'news', 'gaming', 'technology', 'other']
    },
    author: {
        type: String,
        required: [true, 'Author is required'],
        trim: true
    },
    duration: {
        type: Number,
        default: 0,
        min: 0
    },
    views: {
        type: Number,
        default: 0,
        min: 0
    },
    likes: {
        type: Number,
        default: 0,
        min: 0
    },
    fileSize: {
        type: Number,
        default: 0
    },
    mimeType: {
        type: String,
        default: 'video/mp4'
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true // This adds createdAt and updatedAt fields
});

// Indexes for better query performance
videoSchema.index({ author: 1 });
videoSchema.index({ category: 1 });
videoSchema.index({ createdAt: -1 });
videoSchema.index({ views: -1 });
videoSchema.index({ title: 'text', description: 'text' });

const Video = mongoose.model('Video', videoSchema);
export default Video;