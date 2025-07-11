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
let stickyNotes = {};

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);
    users[socket.id] = { 
        position: { x: 0, y: 0.2, z: 0 }, 
        color: randomColor() 
    };

    // Send existing users to new user
    socket.emit('existingUsers', users);
    
    // Send existing sticky notes to new user
    Object.values(stickyNotes).forEach(note => {
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
        console.log(`Received newSticky from ${socket.id}:`, data);

        stickyNotes[data.id] = {
            id: data.id,
            position: data.position,
            text: data.text
        };
        
        socket.broadcast.emit('addSticky', stickyNotes[data.id]);
    });

    socket.on('moveSticky', (data) => {
        console.log(`Received moveSticky from ${socket.id}:`, data);
        
        if (stickyNotes[data.id]) {
            stickyNotes[data.id].position = data.position;
            
            socket.broadcast.emit('stickyMoved', {
                id: data.id,
                position: data.position
            });
        }
    });
});

function randomColor() {
    const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xffa500, 0x800080];
    return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Socket.IO server running on port ${PORT}`);
});