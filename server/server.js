const express = require('express');
const http= require('http');
const {Server}= require('socket.io');
const cors= require('cors');
const { Socket } = require('dgram');

const app= express();
const server= http.createServer(app);
const io= new Server(server, {
    cors:{
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.get('/', (req, res) => {
  res.send('Socket.IO Server is Running');
});


let users={};
io.on('connection',(socket)=>{
    console.log('User Connected : ${socket.id}');
    users[socket.id]={position:{x:0, y:0, z:0}, color: randomColor()};

    socket.emit('existingUsers', users);

    socket.broadcast.emit('newUser',{
        id: socket.id,
        position: users[socket.id].position,
        color: users[socket.id].color
    });

    socket.on('updatePosition', (position)=>{
        if(users[socket.id]){
            users[socket.id].position= position;
            socket.broadcast.emit('userMoved',{id: socket.id, position});
        }
    });

    socket.on('disconnect',()=>{
        console.log('User Disconnected: $(socket.id)');
        delete users[socket.id];
        io.emit("userDisconnected", socket.id);
    });
});

function randomColor() {
  return '#' + Math.floor(Math.random()*16777215).toString(16);
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});


