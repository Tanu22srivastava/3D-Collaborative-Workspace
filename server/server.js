require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

// Import routes that definitely exist
const workspaceRoutes = require('./routes/workspace');
const voiceRoutes = require('./routes/voice');
const authRoutes = require('./routes/auth');

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

// Make io available to routes
app.use((req, res, next) => {
    req.io = io;
    next();
});

// Routes
app.use('/api/workspace', workspaceRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.send('3D Collaborative Workspace Server is Running');
});

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// Simple socket handling - NO SocketManager
const connectedUsers = new Map();
const workspaceUsers = new Map();

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
            avatar: { color: '#' + Math.floor(Math.random()*16777215).toString(16) }
        });
        
        // Track workspace users
        if (!workspaceUsers.has(data.workspaceId)) {
            workspaceUsers.set(data.workspaceId, new Set());
        }
        workspaceUsers.get(data.workspaceId).add(socket.id);
        
        // Send existing users
        const existingUsers = {};
        socket.emit('existingUsers', existingUsers);
        
        // Notify others
        socket.to(data.workspaceId).emit('userJoined', {
            socketId: socket.id,
            userId: data.userId,
            userInfo: data.userInfo,
            position: { x: 0, y: 0.2, z: 0 },
            avatar: { color: '#' + Math.floor(Math.random()*16777215).toString(16) }
        });
        
        console.log(`✅ User ${data.userInfo?.username || 'Anonymous'} joined workspace ${data.workspaceId}`);
    });
    
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
    
    socket.on('disconnect', () => {
        console.log(`🔌 User disconnected: ${socket.id}`);
        
        if (socket.currentWorkspace) {
            socket.to(socket.currentWorkspace).emit('userLeft', {
                socketId: socket.id
            });
        }
        
        connectedUsers.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 3D Collaborative Workspace Server running on port ${PORT}`);
    console.log(`🌐 Open browser: http://localhost:${PORT}`);
});