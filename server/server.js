require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

// Import routes
const workspaceRoutes = require('./routes/workspace');
const voiceRoutes = require('./routes/voice');
const authRoutes = require('./routes/auth');
const modelRoutes = require('./routes/models'); // New 3D models route

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Make io available to routes
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Routes
app.use('/api/workspace', workspaceRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/models', modelRoutes); // Add 3D models route

app.get('/', (req, res) => {
    res.send('3D Collaborative Workspace Server is Running');
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB Atlas'))
    .catch((err) => console.error('❌ MongoDB connection error:', err));

// Enhanced socket handling with 3D models support
const connectedUsers = new Map();
const workspaceUsers = new Map();
const workspaceModels = new Map(); // Track 3D models per workspace

io.on('connection', (socket) => {
    console.log(`🔌 User Connected: ${socket.id}`);

    socket.on('joinWorkspace', (data) => {
        console.log(`👤 User ${socket.id} joining workspace: ${data.workspaceId}`);

        // Join workspace room
        socket.join(data.workspaceId);
        socket.currentWorkspace = data.workspaceId;
        socket.userId = data.userId;
        socket.userInfo = data.userInfo;

        // Track user
        connectedUsers.set(socket.id, {
            userId: data.userId,
            userInfo: data.userInfo,
            workspaceId: data.workspaceId,
            position: { x: 0, y: 0.2, z: 0 },
            avatar: { color: '#' + Math.floor(Math.random() * 16777215).toString(16) }
        });

        // Track workspace users
        if (!workspaceUsers.has(data.workspaceId)) {
            workspaceUsers.set(data.workspaceId, new Set());
        }
        workspaceUsers.get(data.workspaceId).add(socket.id);

        // Send existing users
        const existingUsers = {};
        workspaceUsers.get(data.workspaceId).forEach(userId => {
            if (userId !== socket.id && connectedUsers.has(userId)) {
                existingUsers[userId] = connectedUsers.get(userId);
            }
        });
        socket.emit('existingUsers', existingUsers);

        // Send existing 3D models for this workspace
        if (workspaceModels.has(data.workspaceId)) {
            const models = workspaceModels.get(data.workspaceId);
            models.forEach(model => {
                socket.emit('modelUploaded', { model });
            });
        }

        // Notify others
        socket.to(data.workspaceId).emit('userJoined', {
            socketId: socket.id,
            userId: data.userId,
            userInfo: data.userInfo,
            position: { x: 0, y: 0.2, z: 0 },
            avatar: { color: '#' + Math.floor(Math.random() * 16777215).toString(16) }
        });

        console.log(`✅ User ${data.userInfo?.username || 'Anonymous'} joined workspace ${data.workspaceId}`);
    });

    // Sticky notes events
    socket.on('createNote', (data) => {
        console.log(`📝 Creating note from ${socket.id}:`, {
            text: data.text,
            position: data.position,
            workspace: data.workspaceId
        });

        const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const noteData = {
            id: noteId,
            text: data.text || "New Note",
            position: data.position,
            workspaceId: data.workspaceId,
            createdBy: socket.userId || 'anonymous',
            createdAt: new Date()
        };

        // Broadcast to ALL users in workspace (including sender)
        io.to(data.workspaceId).emit('noteCreated', {
            note: noteData,
            createdBy: {
                username: socket.userInfo?.username || 'Anonymous',
                _id: socket.userId
            }
        });

        console.log(`✅ Note ${noteId} broadcasted to workspace ${data.workspaceId}`);
    });

    socket.on('updateNote', (data) => {
        if (socket.currentWorkspace) {
            socket.to(socket.currentWorkspace).emit('noteUpdated', {
                note: { id: data.noteId, ...data.updates }
            });
        }
    });

    socket.on('deleteNote', (data) => {
        if (socket.currentWorkspace) {
            socket.to(socket.currentWorkspace).emit('noteDeleted', {
                noteId: data.noteId
            });
        }
    });

    // 3D Models events
    socket.on('modelUploaded', (data) => {
        console.log(`📦 Model uploaded from ${socket.id}:`, data.model.name);

        // Track model in workspace
        if (!workspaceModels.has(data.workspaceId)) {
            workspaceModels.set(data.workspaceId, new Map());
        }
        workspaceModels.get(data.workspaceId).set(data.model.id, data.model);

        // Broadcast to other users in workspace
        socket.to(data.workspaceId).emit('modelUploaded', {
            model: data.model
        });

        console.log(`✅ Model ${data.model.name} broadcasted to workspace ${data.workspaceId}`);
    });

    socket.on('modelMoved', (data) => {
        console.log(`📦 Model moved from ${socket.id}:`, {
            modelId: data.modelId,
            position: data.position,
            rotation: data.rotation,
            scale: data.scale
        });

        // Update model in tracking
        if (workspaceModels.has(data.workspaceId)) {
            const models = workspaceModels.get(data.workspaceId);
            if (models.has(data.modelId)) {
                const model = models.get(data.modelId);
                if (data.position) model.position = data.position;
                if (data.rotation) model.rotation = data.rotation;
                if (data.scale) model.scale = data.scale;
            }
        }

        // Broadcast to other users
        socket.to(data.workspaceId).emit('modelMoved', {
            modelId: data.modelId,
            position: data.position,
            rotation: data.rotation,
            scale: data.scale
        });
    });

    socket.on('modelDeleted', (data) => {
        console.log(`🗑️ Model deleted from ${socket.id}:`, data.modelId);

        // Remove from tracking
        if (workspaceModels.has(data.workspaceId)) {
            workspaceModels.get(data.workspaceId).delete(data.modelId);
        }

        // Broadcast to other users
        socket.to(data.workspaceId).emit('modelDeleted', {
            modelId: data.modelId
        });
    });

    // User movement
    socket.on('updatePosition', (position) => {
        if (socket.currentWorkspace && connectedUsers.has(socket.id)) {
            // Update user position in tracking
            const userData = connectedUsers.get(socket.id);
            userData.position = position;

            socket.to(socket.currentWorkspace).emit('userMoved', {
                socketId: socket.id,
                position: position
            });
        }
    });

    // Workspace saving
    socket.on('saveWorkspace', async (data) => {
        console.log(`💾 Saving workspace ${data.workspaceId} from ${socket.id}`);

        try {
            // Here you would save to database
            // For now, just acknowledge the save
            socket.emit('workspaceSaved', {
                success: true,
                workspaceId: data.workspaceId,
                timestamp: new Date()
            });

            // Notify other users about the save
            socket.to(data.workspaceId).emit('workspaceSaved', {
                success: true,
                workspaceId: data.workspaceId,
                savedBy: socket.userInfo?.username || 'Anonymous',
                timestamp: new Date()
            });

        } catch (error) {
            console.error('Error saving workspace:', error);
            socket.emit('workspaceSaved', {
                success: false,
                error: 'Failed to save workspace'
            });
        }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.id}`);

        if (socket.currentWorkspace) {
            // Remove from workspace users
            if (workspaceUsers.has(socket.currentWorkspace)) {
                workspaceUsers.get(socket.currentWorkspace).delete(socket.id);
            }

            // Notify others
            socket.to(socket.currentWorkspace).emit('userLeft', {
                socketId: socket.id
            });
        }

        connectedUsers.delete(socket.id);
    });

    // Debug and utility events
    socket.on('debug', () => {
        console.log('🔍 Debug requested by', socket.id);

        const debugInfo = {
            connectedUsers: Array.from(connectedUsers.keys()),
            workspaceUsers: Object.fromEntries(workspaceUsers),
            workspaceModels: Object.fromEntries(
                Array.from(workspaceModels.entries()).map(([ws, models]) => [
                    ws, Array.from(models.keys())
                ])
            ),
            currentWorkspace: socket.currentWorkspace
        };

        socket.emit('debugResponse', debugInfo);
    });

    // Replace your existing socket connection handler in server/server.js
    // This should be inside: io.on('connection', (socket) => { ... })

    socket.on('joinWorkspace', (data) => {
        console.log(`👤 User ${socket.id} joining workspace: ${data.workspaceId}`);

        // Join workspace room
        socket.join(data.workspaceId);
        socket.currentWorkspace = data.workspaceId;
        socket.userId = data.userId;
        socket.userInfo = data.userInfo;

        // Track user
        connectedUsers.set(socket.id, {
            userId: data.userId,
            userInfo: data.userInfo,
            workspaceId: data.workspaceId,
            position: { x: 0, y: 0.2, z: 0 },
            avatar: { color: '#' + Math.floor(Math.random() * 16777215).toString(16) },
            isVoiceActive: false // Add voice status
        });

        // Track workspace users
        if (!workspaceUsers.has(data.workspaceId)) {
            workspaceUsers.set(data.workspaceId, new Set());
        }
        workspaceUsers.get(data.workspaceId).add(socket.id);

        // Send existing users to the new user
        const existingUsers = {};
        workspaceUsers.get(data.workspaceId).forEach(userId => {
            if (userId !== socket.id && connectedUsers.has(userId)) {
                const userData = connectedUsers.get(userId);
                existingUsers[userId] = {
                    ...userData,
                    isVoiceActive: userData.isVoiceActive || false
                };
            }
        });
        socket.emit('existingUsers', existingUsers);

        // Send existing 3D models for this workspace
        if (workspaceModels.has(data.workspaceId)) {
            const models = workspaceModels.get(data.workspaceId);
            models.forEach(model => {
                socket.emit('modelUploaded', { model });
            });
        }

        // Notify others about the new user (THIS WAS THE PROBLEMATIC LINE)
        socket.to(data.workspaceId).emit('userJoined', {
            socketId: socket.id,
            userId: data.userId,
            userInfo: data.userInfo,
            position: { x: 0, y: 0.2, z: 0 },
            avatar: { color: '#' + Math.floor(Math.random() * 16777215).toString(16) },
            isVoiceActive: false
        });

        console.log(`✅ User ${data.userInfo?.username || 'Anonymous'} joined workspace ${data.workspaceId}`);
    });

    // Add the Voice Chat Events (ADD THESE NEW EVENTS)
    socket.on('voice-started', (data) => {
        console.log(`🎤 User ${socket.id} started voice in workspace ${data.workspaceId}`);

        // Update user data to indicate voice is active
        if (connectedUsers.has(socket.id)) {
            const userData = connectedUsers.get(socket.id);
            userData.isVoiceActive = true;
        }

        // Notify other users in the workspace
        socket.to(data.workspaceId).emit('user-started-voice', {
            socketId: socket.id,
            userId: socket.userId,
            userInfo: socket.userInfo
        });
    });

    socket.on('voice-stopped', (data) => {
        console.log(`🎤 User ${socket.id} stopped voice in workspace ${data.workspaceId}`);

        // Update user data
        if (connectedUsers.has(socket.id)) {
            const userData = connectedUsers.get(socket.id);
            userData.isVoiceActive = false;
        }

        // Notify other users in the workspace
        socket.to(data.workspaceId).emit('user-stopped-voice', {
            socketId: socket.id,
            userId: socket.userId
        });
    });

    // WebRTC Signaling Events (ADD THESE NEW EVENTS)
    socket.on('webrtc-offer', (data) => {
        console.log(`📤 WebRTC offer from ${data.from} to ${data.to}`);

        // Forward offer to the target user
        socket.to(data.to).emit('webrtc-offer', {
            from: data.from,
            offer: data.offer
        });
    });

    socket.on('webrtc-answer', (data) => {
        console.log(`📤 WebRTC answer from ${data.from} to ${data.to}`);

        // Forward answer to the target user
        socket.to(data.to).emit('webrtc-answer', {
            from: data.from,
            answer: data.answer
        });
    });

    socket.on('webrtc-ice-candidate', (data) => {
        console.log(`🧊 ICE candidate from ${data.from} to ${data.to}`);

        // Forward ICE candidate to the target user
        socket.to(data.to).emit('webrtc-ice-candidate', {
            from: data.from,
            candidate: data.candidate
        });
    });

    // Update your existing disconnect handler
    socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.id}`);

        if (socket.currentWorkspace) {
            // Remove from workspace users
            if (workspaceUsers.has(socket.currentWorkspace)) {
                workspaceUsers.get(socket.currentWorkspace).delete(socket.id);
            }

            // Notify others about disconnection
            socket.to(socket.currentWorkspace).emit('userLeft', {
                socketId: socket.id
            });

            // Notify about voice stopping if user was speaking
            if (connectedUsers.has(socket.id) && connectedUsers.get(socket.id).isVoiceActive) {
                socket.to(socket.currentWorkspace).emit('user-stopped-voice', {
                    socketId: socket.id
                });
            }
        }

        connectedUsers.delete(socket.id);
    });


});

// Error handling middleware
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 3D Collaborative Workspace Server running on port ${PORT}`);
    console.log(`🌐 Open browser: http://localhost:${PORT}`);
    console.log(`📦 3D Model uploads enabled`);
    console.log(`📁 Upload directory: ${path.join(__dirname, 'uploads/models')}`);
});