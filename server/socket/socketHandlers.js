const Note = require('../models/Note');
const DrawingStroke = require('../models/DrawingStroke');
const Model3D = require('../models/Model3D');
const Session = require('../models/Session');
const Workspace = require('../models/Workspace');

class SocketManager {
  constructor(io) {
    this.io = io;
    this.activeUsers = new Map(); // socketId -> userData
    this.workspaceUsers = new Map(); // workspaceId -> Set of socketIds
  }

  handleConnection(socket) {
    console.log(`User connected: ${socket.id}`);
    
    // User joins workspace
    socket.on('joinWorkspace', async (data) => {
      try {
        const { workspaceId, userId, userInfo } = data;
        
        // Leave previous workspace if any
        if (socket.currentWorkspace) {
          await this.leaveWorkspace(socket, socket.currentWorkspace);
        }
        
        // Join new workspace
        socket.join(workspaceId);
        socket.currentWorkspace = workspaceId;
        socket.userId = userId;
        
        // Track user
        this.activeUsers.set(socket.id, {
          userId,
          workspaceId,
          userInfo,
          position: { x: 0, y: 0.2, z: 0 },
          avatar: {
            color: this.randomColor(),
            model: 'default'
          },
          isVoiceActive: false,
          joinedAt: new Date()
        });
        
        // Track workspace users
        if (!this.workspaceUsers.has(workspaceId)) {
          this.workspaceUsers.set(workspaceId, new Set());
        }
        this.workspaceUsers.get(workspaceId).add(socket.id);
        
        // Update session
        await this.updateSession(workspaceId, userId, 'joined', socket.id);
        
        // Send existing users to new user
        const workspaceSocketIds = this.workspaceUsers.get(workspaceId);
        const existingUsers = {};
        
        workspaceSocketIds.forEach(socketId => {
          if (socketId !== socket.id && this.activeUsers.has(socketId)) {
            const userData = this.activeUsers.get(socketId);
            existingUsers[socketId] = userData;
          }
        });
        
        socket.emit('existingUsers', existingUsers);
        
        // Notify others about new user
        socket.to(workspaceId).emit('userJoined', {
          socketId: socket.id,
          userId,
          userInfo,
          position: this.activeUsers.get(socket.id).position,
          avatar: this.activeUsers.get(socket.id).avatar
        });
        
        console.log(`User ${userId} joined workspace ${workspaceId}`);
      } catch (error) {
        console.error('Join workspace error:', error);
        socket.emit('error', { message: 'Failed to join workspace' });
      }
    });
    
    // User position updates
    socket.on('updatePosition', (position) => {
      if (this.activeUsers.has(socket.id)) {
        const userData = this.activeUsers.get(socket.id);
        userData.position = position;
        
        socket.to(userData.workspaceId).emit('userMoved', {
          socketId: socket.id,
          position
        });
      }
    });
    
    // Real-time sticky note events
    socket.on('createNote', async (data) => {
      try {
        const { text, position, workspaceId } = data;
        const userData = this.activeUsers.get(socket.id);
        
        if (!userData || userData.workspaceId !== workspaceId) {
          return socket.emit('error', { message: 'Invalid workspace' });
        }
        
        const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const note = new Note({
          id: noteId,
          text,
          position,
          workspaceId,
          createdBy: userData.userId
        });
        
        await note.save();
        await note.populate('createdBy', 'username email');
        
        // Broadcast to workspace
        this.io.to(workspaceId).emit('noteCreated', {
          note: note.toObject(),
          createdBy: note.createdBy
        });
        
        console.log(`Note created in workspace ${workspaceId} by ${userData.userId}`);
      } catch (error) {
        console.error('Create note error:', error);
        socket.emit('error', { message: 'Failed to create note' });
      }
    });
    
    socket.on('updateNote', async (data) => {
      try {
        const { noteId, updates } = data;
        const userData = this.activeUsers.get(socket.id);
        
        const note = await Note.findOne({ id: noteId });
        if (!note) {
          return socket.emit('error', { message: 'Note not found' });
        }
        
        // Check if note is locked
        if (note.isLocked && note.lockedBy.toString() !== userData.userId) {
          return socket.emit('error', { message: 'Note is locked by another user' });
        }
        
        // Update note
        Object.assign(note, updates);
        note.lastModifiedBy = userData.userId;
        note.version += 1;
        
        await note.save();
        await note.populate('lastModifiedBy', 'username email');
        
        // Broadcast update
        socket.to(note.workspaceId.toString()).emit('noteUpdated', {
          note: note.toObject(),
          updatedBy: note.lastModifiedBy
        });
        
      } catch (error) {
        console.error('Update note error:', error);
        socket.emit('error', { message: 'Failed to update note' });
      }
    });
    
    socket.on('deleteNote', async (data) => {
      try {
        const { noteId } = data;
        const userData = this.activeUsers.get(socket.id);
        
        const note = await Note.findOne({ id: noteId });
        if (!note) {
          return socket.emit('error', { message: 'Note not found' });
        }
        
        // Check permissions
        if (note.createdBy.toString() !== userData.userId) {
          const workspace = await Workspace.findById(note.workspaceId);
          const isOwner = workspace.createdBy.toString() === userData.userId;
          const isAdmin = workspace.participants.some(p => 
            p.userId.toString() === userData.userId && p.role === 'admin'
          );
          
          if (!isOwner && !isAdmin) {
            return socket.emit('error', { message: 'Permission denied' });
          }
        }
        
        await Note.deleteOne({ id: noteId });
        
        // Broadcast deletion
        this.io.to(note.workspaceId.toString()).emit('noteDeleted', {
          noteId,
          deletedBy: userData.userId
        });
        
      } catch (error) {
        console.error('Delete note error:', error);
        socket.emit('error', { message: 'Failed to delete note' });
      }
    });
    
    // Drawing events
    socket.on('startStroke', async (data) => {
      try {
        const { workspaceId, strokeData } = data;
        const userData = this.activeUsers.get(socket.id);
        
        if (userData.workspaceId !== workspaceId) {
          return socket.emit('error', { message: 'Invalid workspace' });
        }
        
        // Broadcast stroke start to others
        socket.to(workspaceId).emit('strokeStarted', {
          socketId: socket.id,
          strokeData,
          userId: userData.userId
        });
        
      } catch (error) {
        console.error('Start stroke error:', error);
      }
    });
    
    socket.on('continueStroke', (data) => {
      const { workspaceId, point } = data;
      socket.to(workspaceId).emit('strokeContinued', {
        socketId: socket.id,
        point
      });
    });
    
    socket.on('endStroke', async (data) => {
      try {
        const { workspaceId, strokeData } = data;
        const userData = this.activeUsers.get(socket.id);
        
        // Save stroke to database
        const stroke = new DrawingStroke({
          id: strokeData.id,
          points: strokeData.points,
          color: strokeData.color,
          width: strokeData.width,
          tool: strokeData.tool || 'pen',
          workspaceId,
          createdBy: userData.userId
        });
        
        await stroke.save();
        
        // Broadcast final stroke
        socket.to(workspaceId).emit('strokeCompleted', {
          strokeData,
          createdBy: userData.userId
        });
        
      } catch (error) {
        console.error('End stroke error:', error);
      }
    });
    
    // Voice chat events
    socket.on('toggleVoice', (data) => {
      const { isActive } = data;
      const userData = this.activeUsers.get(socket.id);
      
      if (userData) {
        userData.isVoiceActive = isActive;
        
        socket.to(userData.workspaceId).emit('userVoiceChanged', {
          socketId: socket.id,
          userId: userData.userId,
          isVoiceActive: isActive
        });
      }
    });
    
    // WebRTC signaling
    socket.on('rtc-offer', (data) => {
      socket.to(data.to).emit('rtc-offer', {
        from: socket.id,
        offer: data.offer
      });
    });
    
    socket.on('rtc-answer', (data) => {
      socket.to(data.to).emit('rtc-answer', {
        from: socket.id,
        answer: data.answer
      });
    });
    
    socket.on('rtc-ice-candidate', (data) => {
      socket.to(data.to).emit('rtc-ice-candidate', {
        from: socket.id,
        candidate: data.candidate
      });
    });
    
    // Cursor sharing
    socket.on('cursorMove', (data) => {
      const userData = this.activeUsers.get(socket.id);
      if (userData) {
        socket.to(userData.workspaceId).emit('userCursor', {
          socketId: socket.id,
          userId: userData.userId,
          position: data.position
        });
      }
    });
    
    // Disconnect handling
    socket.on('disconnect', async () => {
      console.log(`User disconnected: ${socket.id}`);
      
      if (this.activeUsers.has(socket.id)) {
        const userData = this.activeUsers.get(socket.id);
        
        // Update session
        await this.updateSession(userData.workspaceId, userData.userId, 'left', socket.id);
        
        // Remove from tracking
        this.activeUsers.delete(socket.id);
        
        if (this.workspaceUsers.has(userData.workspaceId)) {
          this.workspaceUsers.get(userData.workspaceId).delete(socket.id);
          
          // Clean up empty workspace tracking
          if (this.workspaceUsers.get(userData.workspaceId).size === 0) {
            this.workspaceUsers.delete(userData.workspaceId);
          }
        }
        
        // Notify others
        socket.to(userData.workspaceId).emit('userLeft', {
          socketId: socket.id,
          userId: userData.userId
        });
      }
    });
  }
  
  async leaveWorkspace(socket, workspaceId) {
    socket.leave(workspaceId);
    
    if (this.activeUsers.has(socket.id)) {
      const userData = this.activeUsers.get(socket.id);
      await this.updateSession(workspaceId, userData.userId, 'left', socket.id);
    }
  }
  
  async updateSession(workspaceId, userId, action, socketId) {
    try {
      let session = await Session.findOne({ 
        workspaceId, 
        isActive: true 
      });
      
      if (!session && action === 'joined') {
        session = new Session({
          sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          workspaceId,
          participants: []
        });
      }
      
      if (session) {
        let participant = session.participants.find(p => 
          p.userId.toString() === userId
        );
        
        if (action === 'joined') {
          if (!participant) {
            session.participants.push({
              userId,
              socketId,
              joinedAt: new Date(),
              position: { x: 0, y: 0.2, z: 0 },
              isVoiceActive: false,
              avatar: {
                color: this.randomColor(),
                model: 'default'
              }
            });
          }
        } else if (action === 'left' && participant) {
          participant.leftAt = new Date();
        }
        
        // Check if session should end
        const activeParticipants = session.participants.filter(p => !p.leftAt);
        if (activeParticipants.length === 0) {
          session.isActive = false;
          session.endedAt = new Date();
          session.duration = Math.round((new Date() - session.startedAt) / 60000);
        }
        
        await session.save();
      }
    } catch (error) {
      console.error('Update session error:', error);
    }
  }
  
  randomColor() {
    const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

module.exports = SocketManager;