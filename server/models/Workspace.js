const mongoose = require('mongoose');

// Schema for sticky notes
const stickyNotesSchema = new mongoose.Schema({
    id: String,
    text: String,
    position: {
        x: Number,
        y: Number,
        z: Number
    }
});

// Schema for workspace participants
const participantSchema = new mongoose.Schema({
    userId: {
        type: String, // Changed from ObjectId to String to match our simple auth
        required: true
    },
    role: {
        type: String,
        enum: ['owner', 'admin', 'editor', 'viewer'],
        default: 'editor'
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    lastActive: {
        type: Date,
        default: Date.now
    }
});

// Main workspace schema - FIXED to match the code
const workspaceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        maxlength: 100
    },
    description: {
        type: String,
        maxlength: 500
    },
    type: {
        type: String,
        enum: ['2d', '3d', 'mixed'],
        default: '3d'
    },
    settings: {
        maxParticipants: { type: Number, default: 50 },
        isPublic: { type: Boolean, default: false },
        allowAnonymous: { type: Boolean, default: true },
        enableVoiceChat: { type: Boolean, default: true },
        enableDrawing: { type: Boolean, default: true },
        autoSave: { type: Boolean, default: true }
    },
    participants: [participantSchema],
    createdBy: {
        type: String, // Changed from ObjectId to String
        required: true
    },
    tags: [String],
    isArchived: {
        type: Boolean,
        default: false
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    // Keep compatibility with old schema
    notes: [stickyNotesSchema],
    users: [{
        id: String,
        position: {
            x: Number,
            y: Number,
            z: Number
        },
        color: Number
    }]
}, {
    timestamps: true
});

// Index for search and filtering
workspaceSchema.index({ name: 'text', description: 'text' });
workspaceSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Workspace', workspaceSchema);