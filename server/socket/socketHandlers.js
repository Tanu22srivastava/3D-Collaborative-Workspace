require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

// Import routes
const workspaceRoutes = require('../routes/workspace');
const voiceRoutes = require('../routes/voice');
const authRoutes = require('../routes/auth');
const aiRoutes = require('../routes/ai');
const noteRoutes = require('../routes/note');

// Import socket manager
const SocketManager = require('../socket/socketHandlers');

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
app.use('/uploads', express.static('uploads'));

// Make io available to routes
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Routes
app.use('/api/workspace', workspaceRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/note', noteRoutes);

app.get('/', (req, res) => {
    res.send('3D Collaborative Workspace Server is Running');
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);
    
    // Use the socket manager for all events
    socketManager.handleConnection(socket);
    
    // Additional debugging and fallback events
    socket.on('createNote', async (data) => {
        console.log(`Direct createNote from ${socket.id}:`, data);
        
        try {
            // Simple in-memory note creation for immediate feedback
            const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const noteData = {
                id: noteId,
                text: data.text || "New Note",
                position: data.position,
                workspaceId: data.workspaceId,
                createdBy: socket.userId || 'anonymous'
            };
            
            // Broadcast to all users in the workspace
            io.to(data.workspaceId).emit('noteCreated', {
                note: noteData,
                createdBy: { username: 'User' }
            });
            
            console.log(`Note created and broadcasted: ${noteId}`);
        } catch (error) {
            console.error('Error creating note:', error);
            socket.emit('error', { message: 'Failed to create note' });
        }
    });
    
    socket.on('joinWorkspace', (data) => {
        console.log(`User ${socket.id} joining workspace: ${data.workspaceId}`);
        socket.join(data.workspaceId);
        socket.workspaceId = data.workspaceId;
        socket.userId = data.userId;
        
        // Notify others in the workspace
        socket.to(data.workspaceId).emit('userJoined', {
            socketId: socket.id,
            userId: data.userId,
            userInfo: data.userInfo,
            position: { x: 0, y: 0.2, z: 0 },
            avatar: { color: '#' + Math.floor(Math.random()*16777215).toString(16) }
        });
        
        // Send existing users to the new user
        socket.emit('existingUsers', {});
    });
    
    socket.on('updatePosition', (position) => {
        if (socket.workspaceId) {
            socket.to(socket.workspaceId).emit('userMoved', {
                socketId: socket.id,
                position: position
            });
        }
    });
    
    socket.on('updateNote', (data) => {
        console.log(`Update note from ${socket.id}:`, data);
        if (socket.workspaceId) {
            socket.to(socket.workspaceId).emit('noteUpdated', {
                note: {
                    id: data.noteId,
                    ...data.updates
                }
            });
        }
    });
    
    socket.on('deleteNote', (data) => {
        console.log(`Delete note from ${socket.id}:`, data);
        if (socket.workspaceId) {
            socket.to(socket.workspaceId).emit('noteDeleted', {
                noteId: data.noteId
            });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        if (socket.workspaceId) {
            socket.to(socket.workspaceId).emit('userLeft', {
                socketId: socket.id
            });
        }
    });
    
    // Fallback events for backward compatibility
    socket.on('newSticky', (data) => {
        console.log(`Received newSticky from ${socket.id}:`, data);
        socket.broadcast.emit('addSticky', data);
    });

    socket.on('moveSticky', (data) => {
        console.log(`Received moveSticky from ${socket.id}:`, data);
        socket.broadcast.emit('stickyMoved', data);
    });

    socket.on('updateStickyText', (data) => {
        console.log(`Received updateStickyText from ${socket.id}:`, data);
        socket.broadcast.emit('stickyTextUpdated', data);
    });

    socket.on('deleteSticky', (data) => {
        console.log(`Received deleteSticky from ${socket.id}:`, data);
        socket.broadcast.emit('stickyDeleted', data);
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
    console.log(`3D Collaborative Workspace Server running on port ${PORT}`);
    console.log(`Frontend should connect to: http://localhost:${PORT}`);
});