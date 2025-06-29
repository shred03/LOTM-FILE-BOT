const mongoose = require('mongoose');

const tvPostSchema = new mongoose.Schema({
    postId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    adminId: {
        type: Number,
        required: true,
        index: true
    },
    seriesName: {
        type: String,
        required: true
    },
    seriesId: {
        type: Number,
        required: true
    },
    channelId: {
        type: String,
        required: true
    },
    channelUsername: {
        type: String,
        default: null
    },
    messageId: {
        type: Number,
        required: true
    },
    seasonLinks: [{
        type: String,
        required: true
    }],
    seriesData: {
        type: Object,
        required: true
    },
    imageUrl: {
        type: String,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

tvPostSchema.index({ adminId: 1, createdAt: -1 });
tvPostSchema.index({ postId: 1, adminId: 1 });

tvPostSchema.statics.createTVPost = async function(postData) {
    try {
        const tvPost = new this(postData);
        return await tvPost.save();
    } catch (error) {
        throw error;
    }
};

tvPostSchema.statics.findByPostId = async function(postId) {
    try {
        return await this.findOne({ postId, isActive: true });
    } catch (error) {
        throw error;
    }
};

tvPostSchema.statics.findByAdminId = async function(adminId, limit = 10) {
    try {
        return await this.find({ adminId, isActive: true })
            .sort({ createdAt: -1 })
            .limit(limit);
    } catch (error) {
        throw error;
    }
};

tvPostSchema.statics.updateSeasonLinks = async function(postId, seasonLinks) {
    try {
        return await this.findOneAndUpdate(
            { postId, isActive: true },
            { seasonLinks, updatedAt: new Date() },
            { new: true }
        );
    } catch (error) {
        throw error;
    }
};

tvPostSchema.statics.deactivatePost = async function(postId) {
    try {
        return await this.findOneAndUpdate(
            { postId },
            { isActive: false },
            { new: true }
        );
    } catch (error) {
        throw error;
    }
};

tvPostSchema.statics.cleanupOldPosts = async function() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return await this.updateMany(
            { createdAt: { $lt: thirtyDaysAgo } },
            { isActive: false }
        );
    } catch (error) {
        throw error;
    }
};

module.exports = mongoose.model('TVPost', tvPostSchema);