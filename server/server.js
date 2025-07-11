const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.get('/', (req, res) => {
    res.send('Socket.IO Server is Running');
});

let users = {};
let stickyNotes = []; // Store sticky notes for new users

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);
    users[socket.id] = { 
        position: { x: 0, y: 0, z: 0 }, 
        color: randomColor() 
    };

    // Send existing users to new user
    socket.emit('existingUsers', users);
    
    // Send existing sticky notes to new user
    stickyNotes.forEach(note => {
        socket.emit('addSticky', note);
    });

    // Broadcast new user to all other users
    socket.broadcast.emit('newUser', {
        id: socket.id,
        position: users[socket.id].position,
        color: users[socket.id].color
    });

    socket.on('updatePosition', (position) => {
        if (users[socket.id]) {
            users[socket.id].position = position;
            socket.broadcast.emit('userMoved', { id: socket.id, position });
        }
    });

    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        delete users[socket.id];
        io.emit("userDisconnected", socket.id);
    });

    socket.on('newSticky', (data) => {
        // Store the sticky note
        stickyNotes.push(data);
        
        // Broadcast to all other users (not the sender)
        socket.broadcast.emit('addSticky', data);
    });
});

function randomColor() {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffa500', '#800080'];
    return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Socket.IO server running on port ${PORT}`);
});