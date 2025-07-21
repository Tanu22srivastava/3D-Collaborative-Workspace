const mongoose= require('mongoose')

const stickyNotesSchema = new mongoose.Schema({
    id: String,
    text: String,
    position:{
        x: Number,
        y: Number,
        z: Number
    }
});

const workSpaceSchema= new mongoose.Schema({
    name: String,
    notes: [stickyNotesSchema],
    users:[{
        id: String,
        position:{
            x:Number,
            y:Number,
            z:Number
        },
        color: Number
    }],

    createdAt: {type: Date, default: Date.now}
});

const participantSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  }
}, {
  timestamps: true
});

// Index for search and filtering
workspaceSchema.index({ name: 'text', description: 'text' });
workspaceSchema.index({ createdBy: 1, createdAt: -1 });
workspaceSchema.index({ 'participants.userId': 1 });

module.exports= mongoose.model('workspace',workSpaceSchema);