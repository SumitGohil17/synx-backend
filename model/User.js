import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
    supabaseId: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    subscribers: [{ type: Schema.Types.ObjectId, ref: 'User' }], // users who subscribed to this user
    subscriptions: [{ type: Schema.Types.ObjectId, ref: 'User' }], // users this user has subscribed to
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
export default User;
