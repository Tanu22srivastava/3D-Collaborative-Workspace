// Import Three.js modules
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Make THREE available globally for debugging
window.THREE = THREE;

// Auth check and initialization
const API_BASE = 'http://localhost:3000/api';
let authToken = localStorage.getItem('authToken');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentWorkspaceId = localStorage.getItem('currentWorkspaceId');

// Check authentication
if (!authToken) {
    window.location.href = 'index.html';
}

// If no workspace selected, redirect to workspace selector
if (!currentWorkspaceId) {
    window.location.href = 'workspace-selector.html';
}

// Initialize user info safely
const userNameEl = document.getElementById('userName');
const userEmailEl = document.getElementById('userEmail');
const userAvatarEl = document.getElementById('userAvatar');
const currentWorkspaceIdEl = document.getElementById('currentWorkspaceId');

if (userNameEl) userNameEl.textContent = currentUser.username || 'User';
if (userEmailEl) userEmailEl.textContent = currentUser.email || '';
if (userAvatarEl) userAvatarEl.textContent = (currentUser.username || 'U')[0].toUpperCase();
if (currentWorkspaceIdEl) currentWorkspaceIdEl.textContent = currentWorkspaceId || 'Loading...';

// Socket connection
const socket = io('http://localhost:3000', {
    transports: ['websocket'],
    auth: {
        token: authToken,
        user: currentUser
    }
});



// Voice Chat System
class VoiceChat {
    // Add these properties to your existing constructor
    constructor() {
        this.localStream = null;
        this.peerConnections = new Map(); // ADD THIS
        this.remoteStreams = new Map(); // ADD THIS
        this.audioElements = new Map(); // ADD THIS
        this.isMuted = true;
        this.isSpeakerOn = true;
        this.volume = 0.5;
        this.spatialAudioEnabled = true; // ADD THIS

        // ADD WebRTC configuration
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.setupUI();
        this.setupSocketEvents();
    }

    setupUI() {
        // Mic toggle button
        document.getElementById('toggleMicBtn')?.addEventListener('click', () => {
            this.toggleMicrophone();
        });

        // Speaker toggle button
        document.getElementById('toggleSpeakerBtn')?.addEventListener('click', () => {
            this.toggleSpeaker();
        });

        // Volume slider
        document.getElementById('volumeSlider')?.addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
        });
    }

    async toggleMicrophone() {
        if (this.isMuted) {
            await this.startMicrophone();
        } else {
            this.stopMicrophone();
        }
    }

    async startMicrophone() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.isMuted = false;
            this.updateMicUI();

            console.log('🎤 Microphone started');

            // CHANGE: Update the socket event name and emit correctly
            socket.emit('voice-started', {
                workspaceId: currentWorkspaceId,
                socketId: socket.id
            });

            // Create connections to existing users who might have voice active
            Object.keys(onlineUsers).forEach(socketId => {
                if (socketId !== socket.id) {
                    // Small delay to ensure the other user receives our voice-started event
                    setTimeout(() => {
                        this.createPeerConnection(socketId, true);
                    }, 500);
                }
            });

        } catch (error) {
            console.error('❌ Microphone access denied:', error);
            alert('Microphone access denied. Please enable microphone permissions and refresh.');
        }
    }

    stopMicrophone() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Close all peer connections
        this.peerConnections.forEach((pc, socketId) => {
            pc.close();
        });
        this.peerConnections.clear();

        // Remove all audio elements
        document.querySelectorAll('audio[id^="audio-"]').forEach(audio => audio.remove());

        this.isMuted = true;
        this.updateMicUI();
        this.updateConnectionCount();

        console.log('🎤 Microphone stopped');

        // CHANGE: Update the socket event name
        socket.emit('voice-stopped', {
            workspaceId: currentWorkspaceId,
            socketId: socket.id
        });
    }

    toggleSpeaker() {
        this.isSpeakerOn = !this.isSpeakerOn;
        this.updateSpeakerUI();

        // Mute/unmute all remote audio streams
        document.querySelectorAll('audio').forEach(audio => {
            audio.muted = !this.isSpeakerOn;
        });

        console.log('🔊 Speaker:', this.isSpeakerOn ? 'ON' : 'OFF');
    }

    setVolume(volume) {
        this.volume = volume;

        // Apply volume to all remote audio streams
        document.querySelectorAll('audio').forEach(audio => {
            audio.volume = volume;
        });

        console.log('🔊 Volume set to:', Math.round(volume * 100) + '%');
    }

    updateMicUI() {
        const micBtn = document.getElementById('toggleMicBtn');
        const micDot = document.getElementById('micDot');
        const micText = document.getElementById('micText');

        if (this.isMuted) {
            micBtn.textContent = '🎤 Unmute';
            micBtn.className = 'btn btn-secondary';
            micDot.classList.remove('active');
            micText.textContent = 'Microphone: Off';
        } else {
            micBtn.textContent = '🔇 Mute';
            micBtn.className = 'btn btn-danger';
            micDot.classList.add('active');
            micText.textContent = 'Microphone: On';
        }
    }

    updateSpeakerUI() {
        const speakerBtn = document.getElementById('toggleSpeakerBtn');

        if (this.isSpeakerOn) {
            speakerBtn.textContent = '🔊 Speaker On';
            speakerBtn.className = 'btn btn-secondary';
        } else {
            speakerBtn.textContent = '🔇 Speaker Off';
            speakerBtn.className = 'btn btn-danger';
        }
    }

    setupSocketEvents() {
        // WebRTC signaling events
        socket.on('webrtc-offer', async (data) => {
            await this.handleOffer(data);
        });

        socket.on('webrtc-answer', async (data) => {
            await this.handleAnswer(data);
        });

        socket.on('webrtc-ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });

        socket.on('user-started-voice', (data) => {
            console.log('🎤 User started voice:', data.socketId);
            this.createPeerConnection(data.socketId);
        });

        socket.on('user-stopped-voice', (data) => {
            console.log('🎤 User stopped voice:', data.socketId);
            this.removePeerConnection(data.socketId);
        });
    }

    // Create audio element for remote user
    createRemoteAudio(userId, stream) {
        // Remove existing audio element if any
        const existingAudio = document.getElementById(`audio-${userId}`);
        if (existingAudio) {
            existingAudio.remove();
        }

        // Create new audio element
        const audio = document.createElement('audio');
        audio.id = `audio-${userId}`;
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.volume = this.volume;
        audio.muted = !this.isSpeakerOn;

        // Hide audio element
        audio.style.display = 'none';
        document.body.appendChild(audio);

        this.audioElements.set(userId, audio); // ADD THIS LINE

        console.log('🔊 Created audio element for', userId);
    }

    // Remove audio element for user who left
    removeRemoteAudio(userId) {
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) {
            audio.remove();
            console.log('🔊 Removed audio stream for user:', userId);
        }
    }

    // ADD these methods to your existing VoiceChat class in workspace.js

    setupSocketEvents() {
        // WebRTC signaling events
        socket.on('webrtc-offer', async (data) => {
            await this.handleOffer(data);
        });

        socket.on('webrtc-answer', async (data) => {
            await this.handleAnswer(data);
        });

        socket.on('webrtc-ice-candidate', async (data) => {
            await this.handleIceCandidate(data);
        });

        socket.on('user-started-voice', (data) => {
            console.log('🎤 User started voice:', data.socketId);
            if (this.localStream) {
                this.createPeerConnection(data.socketId, true); // We initiate
            }
        });

        socket.on('user-stopped-voice', (data) => {
            console.log('🎤 User stopped voice:', data.socketId);
            this.removePeerConnection(data.socketId);
            this.updateConnectionCount();
        });
    }

    async createPeerConnection(remoteSocketId, isInitiator = false) {
        if (this.peerConnections.has(remoteSocketId)) {
            console.log('⚠️ Peer connection already exists for', remoteSocketId);
            return;
        }

        console.log('🔗 Creating peer connection with', remoteSocketId, 'as', isInitiator ? 'initiator' : 'receiver');

        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        });

        this.peerConnections.set(remoteSocketId, pc);

        // Add local stream if we have one
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Handle incoming stream
        pc.ontrack = (event) => {
            console.log('📡 Received remote stream from', remoteSocketId);
            const remoteStream = event.streams[0];
            this.createRemoteAudio(remoteSocketId, remoteStream);
            this.updateConnectionCount();
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('🧊 Sending ICE candidate to', remoteSocketId);
                socket.emit('webrtc-ice-candidate', {
                    to: remoteSocketId,
                    from: socket.id,
                    candidate: event.candidate
                });
            }
        };

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            console.log('🔗 Connection state with', remoteSocketId, ':', pc.connectionState);
            this.updateConnectionCount();

            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                this.removePeerConnection(remoteSocketId);
            }
        };

        // If we're the initiator, create and send offer
        if (isInitiator) {
            try {
                const offer = await pc.createOffer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false
                });
                await pc.setLocalDescription(offer);

                console.log('📤 Sending offer to', remoteSocketId);
                socket.emit('webrtc-offer', {
                    to: remoteSocketId,
                    from: socket.id,
                    offer: offer
                });
            } catch (error) {
                console.error('❌ Error creating offer:', error);
            }
        }
    }

    async handleOffer(data) {
        const { from, offer } = data;
        console.log('📥 Received offer from', from);

        if (!this.localStream) {
            console.log('⚠️ No local stream, ignoring offer');
            return;
        }

        // Create peer connection if it doesn't exist
        if (!this.peerConnections.has(from)) {
            await this.createPeerConnection(from, false);
        }

        const pc = this.peerConnections.get(from);

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            console.log('📤 Sending answer to', from);
            socket.emit('webrtc-answer', {
                to: from,
                from: socket.id,
                answer: answer
            });
        } catch (error) {
            console.error('❌ Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        const { from, answer } = data;
        console.log('📥 Received answer from', from);

        const pc = this.peerConnections.get(from);
        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
                console.log('✅ Set remote description for', from);
            } catch (error) {
                console.error('❌ Error handling answer:', error);
            }
        }
    }

    async handleIceCandidate(data) {
        const { from, candidate } = data;
        console.log('🧊 Received ICE candidate from', from);

        const pc = this.peerConnections.get(from);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log('✅ Added ICE candidate from', from);
            } catch (error) {
                console.error('❌ Error adding ICE candidate:', error);
            }
        }
    }

    removePeerConnection(socketId) {
        const pc = this.peerConnections.get(socketId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(socketId);
        }

        this.removeRemoteAudio(socketId);
        this.updateConnectionCount();
        console.log('🗑️ Removed peer connection for', socketId);
    }

    updateConnectionCount() {
        const connectionText = document.getElementById('connectionText');
        const connectionDot = document.getElementById('connectionDot');

        const activeConnections = this.peerConnections.size;

        if (connectionText) {
            connectionText.textContent = `Connections: ${activeConnections}`;
        }

        if (connectionDot) {
            connectionDot.classList.toggle('active', activeConnections > 0);
        }

        console.log('📊 Active connections:', activeConnections);
    }

    async createPeerConnection(remoteSocketId, isInitiator = false) {
        if (this.peerConnections.has(remoteSocketId)) return;

        const pc = new RTCPeerConnection(this.rtcConfig);
        this.peerConnections.set(remoteSocketId, pc);

        console.log('🔗 Creating peer connection with', remoteSocketId);

        // Add local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Handle incoming stream
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];
            this.remoteStreams.set(remoteSocketId, remoteStream);
            this.createRemoteAudio(remoteSocketId, remoteStream);
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', {
                    to: remoteSocketId,
                    from: socket.id,
                    candidate: event.candidate
                });
            }
        };

        // If initiator, create offer
        if (isInitiator) {
            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);

                socket.emit('webrtc-offer', {
                    to: remoteSocketId,
                    from: socket.id,
                    offer: offer
                });
            } catch (error) {
                console.error('❌ Error creating offer:', error);
            }
        }
    }

    async handleOffer(data) {
        const { from, offer } = data;

        if (!this.localStream) return;

        if (!this.peerConnections.has(from)) {
            await this.createPeerConnection(from, false);
        }

        const pc = this.peerConnections.get(from);

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('webrtc-answer', {
                to: from,
                from: socket.id,
                answer: answer
            });
        } catch (error) {
            console.error('❌ Error handling offer:', error);
        }
    }

    async handleAnswer(data) {
        const { from, answer } = data;
        const pc = this.peerConnections.get(from);

        if (pc) {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error('❌ Error handling answer:', error);
            }
        }
    }

    async handleIceCandidate(data) {
        const { from, candidate } = data;
        const pc = this.peerConnections.get(from);

        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
                console.error('❌ Error adding ICE candidate:', error);
            }
        }
    }

    removePeerConnection(socketId) {
        const pc = this.peerConnections.get(socketId);
        if (pc) {
            pc.close();
            this.peerConnections.delete(socketId);
        }

        this.removeRemoteAudio(socketId);
        this.remoteStreams.delete(socketId);
    }
}

// Initialize voice chat system
const voiceChat = new VoiceChat();



// Global variables
const otherUsers = {};
const onlineUsers = {};
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// 3D Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0xFFFFFF);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Add OrbitControls for 3D navigation
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxDistance = 100;
controls.minDistance = 1;

// Environment setup
const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x888888);
scene.add(gridHelper);

const planeGem = new THREE.PlaneGeometry(50, 50);
const planeMaterial = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.8
});
const plane = new THREE.Mesh(planeGem, planeMaterial);
plane.rotation.x = -Math.PI / 2;
plane.receiveShadow = true;
scene.add(plane);

// User avatar
const avatarGeo = new THREE.SphereGeometry(0.2, 32, 32);
const avatarMaterial = new THREE.MeshStandardMaterial({ color: 0x0000ff });
const avatar = new THREE.Mesh(avatarGeo, avatarMaterial);
avatar.castShadow = true;
scene.add(avatar);
avatar.position.y = 0.2;

// Movement controls
let moveX = 0, moveZ = 0;
let useAvatarMovement = true;

// Enhanced lighting for better 3D model visibility
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(10, 10, 5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -10;
directionalLight.shadow.camera.right = 10;
directionalLight.shadow.camera.top = 10;
directionalLight.shadow.camera.bottom = -10;
scene.add(directionalLight);

const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
scene.add(ambientLight);

const pointLight1 = new THREE.PointLight(0xffffff, 0.5);
pointLight1.position.set(10, 10, 10);
scene.add(pointLight1);

const pointLight2 = new THREE.PointLight(0xffffff, 0.5);
pointLight2.position.set(-10, 10, -10);
scene.add(pointLight2);

camera.position.set(5, 5, 5);
controls.target.set(0, 0, 0);
controls.update();

// 3D Models and Sticky Notes storage
const stickyNotes = {};
const threeDModels = {};
let selectedModel = null;

// Setup loaders with proper configuration
const gltfLoader = new GLTFLoader();
const objLoader = new OBJLoader();

// Configure DRACO decoder for compressed GLTF models
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://unpkg.com/three@0.155.0/examples/js/libs/draco/');
gltfLoader.setDRACOLoader(dracoLoader);

console.log('✅ Three.js loaders initialized successfully');

// Socket event handlers
socket.on('connect', () => {
    console.log('✅ Connected to server');
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = 'none';

    console.log('🏠 Joining workspace:', currentWorkspaceId);
    socket.emit('joinWorkspace', {
        workspaceId: currentWorkspaceId,
        userId: currentUser._id,
        userInfo: currentUser
    });
});

socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
        loadingEl.style.display = 'flex';
        loadingEl.innerHTML = '<div class="loading-spinner"></div>Reconnecting...';
    }
});

// Model-related socket events
socket.on('modelUploaded', ({ model }) => {
    console.log('📦 New model uploaded:', model);
    loadThreeDModel(model);
});

socket.on('modelMoved', ({ modelId, position, rotation, scale }) => {
    console.log('📦 Model moved:', { modelId, position, rotation, scale });
    const model = threeDModels[modelId];
    if (model) {
        if (position) model.position.set(position.x, position.y, position.z);
        if (rotation) model.rotation.set(rotation.x, rotation.y, rotation.z);
        if (scale) model.scale.set(scale.x, scale.y, scale.z);

        // Update controls if this is the selected model
        if (selectedModel === model) {
            updateModelControlsDisplay();
        }
    }
});

socket.on('modelDeleted', ({ modelId }) => {
    console.log('🗑️ Model deleted:', modelId);
    const model = threeDModels[modelId];
    if (model) {
        scene.remove(model);
        delete threeDModels[modelId];
        updateModelsListDisplay();
        if (selectedModel && selectedModel.userData.id === modelId) {
            selectedModel = null;
            document.getElementById('modelControls').style.display = 'none';
        }
    }
});

// User and note events
socket.on('existingUsers', (users) => {
    console.log('👥 Received existing users:', users);
    Object.entries(users).forEach(([id, userData]) => {
        if (id !== socket.id) {
            createOtherUser(id, userData);
            addToOnlineUsers(id, userData);
        }
    });
});

socket.on('userJoined', (data) => {
    console.log('👋 User joined:', data);
    if (data.socketId === socket.id) return;
    createOtherUser(data.socketId, data);
    addToOnlineUsers(data.socketId, data);
});

socket.on('userMoved', ({ socketId, position }) => {
    const user = otherUsers[socketId];
    if (user) {
        user.position.set(position.x, position.y, position.z);
    }
});

socket.on('userLeft', ({ socketId }) => {
    console.log('👋 User left:', socketId);
    if (otherUsers[socketId]) {
        scene.remove(otherUsers[socketId]);
        delete otherUsers[socketId];
        removeFromOnlineUsers(socketId);
    }
});

socket.on('noteCreated', ({ note }) => {
    console.log('📝 Note created:', note);
    const pos = new THREE.Vector3(note.position.x, note.position.y, note.position.z);
    createStickyNote(pos, note.text, note.id);
});

socket.on('noteUpdated', ({ note }) => {
    console.log('✏️ Note updated:', note);
    const stickyNote = stickyNotes[note.id];
    if (stickyNote) {
        if (note.text) stickyNote.setText(note.text);
        if (note.position) {
            const pos = new THREE.Vector3(note.position.x, note.position.y, note.position.z);
            stickyNote.setPosition(pos);
        }
    }
});

socket.on('noteDeleted', ({ noteId }) => {
    console.log('🗑️ Note deleted:', noteId);
    const stickyNote = stickyNotes[noteId];
    if (stickyNote) {
        stickyNote.destroy();
    }
});


// Voice Chat Socket Events (add these after existing socket.on events)
socket.on('voiceStreamStarted', ({ userId }) => {
    console.log('🎤 User started voice:', userId);
    // Update UI to show user is speaking
    updateUserVoiceStatus(userId, true);
});

socket.on('voiceStreamStopped', ({ userId }) => {
    console.log('🎤 User stopped voice:', userId);
    // Update UI to show user stopped speaking
    updateUserVoiceStatus(userId, false);
    voiceChat.removeRemoteAudio(userId);
});

function updateUserVoiceStatus(userId, isSpeaking) {
    // Find the user in online users list and add voice indicator
    const usersList = document.getElementById('usersList');
    if (usersList) {
        const userElements = usersList.querySelectorAll('.online-user');
        userElements.forEach(userEl => {
            const userName = userEl.querySelector('div:nth-child(2)').textContent;
            // This is a simple check - in real implementation you'd match by userId
            if (isSpeaking) {
                userEl.style.borderLeft = '3px solid #27ae60'; // Green border for speaking
            } else {
                userEl.style.borderLeft = 'none';
            }
        });
    }
}

// 3D Model Upload Functionality
function setupFileUpload() {
    const fileUploadArea = document.getElementById('fileUploadArea');
    const fileInput = document.getElementById('fileInput');

    // Click to upload
    fileUploadArea.addEventListener('click', () => {
        fileInput.click();
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Drag and drop
    fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUploadArea.classList.add('dragover');
    });

    fileUploadArea.addEventListener('dragleave', () => {
        fileUploadArea.classList.remove('dragover');
    });

    fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUploadArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

function handleFiles(files) {
    Array.from(files).forEach(file => {
        if (isValidModelFile(file)) {
            loadModelFileDirectly(file);
        } else {
            alert(`Unsupported file type: ${file.name}. Please use GLTF, GLB, or OBJ files.`);
        }
    });
}

function isValidModelFile(file) {
    const validExtensions = ['.gltf', '.glb', '.obj'];
    const fileName = file.name.toLowerCase();
    return validExtensions.some(ext => fileName.endsWith(ext));
}

function loadModelFileDirectly(file) {
    console.log('📤 Loading model directly:', file.name);

    const modelId = `model_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const fileType = file.name.toLowerCase().split('.').pop();

    const reader = new FileReader();

    reader.onload = function (e) {
        try {
            if (fileType === 'gltf') {
                const gltfData = JSON.parse(e.target.result);
                loadGLTFFromData(gltfData, file.name, modelId);
            } else if (fileType === 'glb') {
                loadGLBFromBuffer(e.target.result, file.name, modelId);
            } else if (fileType === 'obj') {
                loadOBJFromText(e.target.result, file.name, modelId);
            }
        } catch (error) {
            console.error('Error loading model:', error);
            alert('Error loading model: ' + error.message);
        }
    };

    if (fileType === 'glb') {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
}

function loadGLTFFromData(gltfData, fileName, modelId) {
    console.log('🔄 Loading GLTF data...');

    gltfLoader.parse(JSON.stringify(gltfData), '', function (gltf) {
        const model = gltf.scene;
        setupModel(model, { name: fileName, fileType: 'gltf' }, modelId);
        console.log('✅ GLTF model loaded successfully');
    }, function (error) {
        console.error('❌ GLTF loading failed:', error);
        alert('Failed to load GLTF model: ' + error.message);
    });
}

function loadGLBFromBuffer(buffer, fileName, modelId) {
    console.log('🔄 Loading GLB buffer...');

    gltfLoader.parse(buffer, '', function (gltf) {
        const model = gltf.scene;
        setupModel(model, { name: fileName, fileType: 'glb' }, modelId);
        console.log('✅ GLB model loaded successfully');
    }, function (error) {
        console.error('❌ GLB loading failed:', error);
        alert('Failed to load GLB model: ' + error.message);
    });
}

function loadOBJFromText(objText, fileName, modelId) {
    console.log('🔄 Loading OBJ text...');

    try {
        const object = objLoader.parse(objText);

        // Add basic material to OBJ models
        object.traverse(function (child) {
            if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    metalness: 0.2,
                    roughness: 0.8
                });
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        setupModel(object, { name: fileName, fileType: 'obj' }, modelId);
        console.log('✅ OBJ model loaded successfully');
    } catch (error) {
        console.error('❌ OBJ loading failed:', error);
        alert('Failed to load OBJ model: ' + error.message);
    }
}

function setupModel(model, modelData, modelId) {
    // Calculate model bounding box for proper positioning
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Move model so its bottom is on the ground
    model.position.set(0, -box.min.y, 0);

    // Scale model if it's too large
    const maxSize = Math.max(size.x, size.y, size.z);
    if (maxSize > 5) {
        const scale = 5 / maxSize;
        model.scale.setScalar(scale);
    }

    // Add metadata
    model.userData = {
        id: modelId,
        name: modelData.name,
        type: '3dmodel',
        originalData: modelData,
        originalSize: size,
        originalCenter: center
    };

    // Enable shadows for all meshes
    model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            // Ensure material exists
            if (!child.material) {
                child.material = new THREE.MeshStandardMaterial({
                    color: 0x888888,
                    metalness: 0.2,
                    roughness: 0.8
                });
            }
        }
    });

    // Add to scene and tracking
    scene.add(model);
    threeDModels[modelId] = model;

    console.log('✅ Model added to scene:', modelData.name);
    updateModelsListDisplay();

    // Notify other users
    socket.emit('modelUploaded', {
        workspaceId: currentWorkspaceId,
        model: {
            id: modelId,
            name: modelData.name,
            fileType: modelData.fileType,
            position: { x: model.position.x, y: model.position.y, z: model.position.z },
            rotation: { x: model.rotation.x, y: model.rotation.y, z: model.rotation.z },
            scale: { x: model.scale.x, y: model.scale.y, z: model.scale.z }
        }
    });
}

function loadThreeDModel(modelData) {
    console.log('🎯 Loading 3D model from data:', modelData);

    // Create a placeholder for remote models
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
        color: 0xff6b6b,
        metalness: 0.3,
        roughness: 0.7
    });
    const placeholder = new THREE.Mesh(geometry, material);
    placeholder.castShadow = true;
    placeholder.receiveShadow = true;

    // Set position, rotation, scale
    const pos = modelData.position || { x: 0, y: 1, z: 0 };
    const rot = modelData.rotation || { x: 0, y: 0, z: 0 };
    const scale = modelData.scale || { x: 1, y: 1, z: 1 };

    placeholder.position.set(pos.x, pos.y, pos.z);
    placeholder.rotation.set(rot.x, rot.y, rot.z);
    placeholder.scale.set(scale.x, scale.y, scale.z);

    // Add metadata
    placeholder.userData = {
        id: modelData.id,
        name: modelData.name,
        type: '3dmodel',
        originalData: modelData
    };

    // Add to scene and tracking
    scene.add(placeholder);
    threeDModels[modelData.id] = placeholder;
    updateModelsListDisplay();
}

function updateModelsListDisplay() {
    const modelsList = document.getElementById('modelsList');
    const models = Object.values(threeDModels);

    if (models.length === 0) {
        modelsList.innerHTML = `
            <div style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px; font-size: 12px;">
                No 3D models uploaded yet
            </div>
        `;
        return;
    }

    modelsList.innerHTML = models.map(model => `
        <div class="model-item ${selectedModel === model ? 'selected' : ''}" 
             onclick="selectModel('${model.userData.id}')">
            <div class="model-info">
                <h4>${model.userData.name}</h4>
                <p>Type: ${model.userData.originalData?.fileType?.toUpperCase() || 'Model'}</p>
            </div>
            <div class="model-actions">
                <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 10px;" 
                        onclick="event.stopPropagation(); focusOnModel('${model.userData.id}')">👁️</button>
                <button class="btn btn-danger" style="padding: 4px 8px; font-size: 10px;" 
                        onclick="event.stopPropagation(); deleteModel('${model.userData.id}')">🗑️</button>
            </div>
        </div>
    `).join('');
}

function selectModel(modelId) {
    const model = threeDModels[modelId];
    if (!model) return;

    selectedModel = model;
    updateModelsListDisplay();

    // Show controls
    const controls = document.getElementById('modelControls');
    controls.style.display = 'block';

    // Update control values
    document.getElementById('selectedModelName').textContent = model.userData.name;
    updateModelControlsDisplay();
}

function updateModelControlsDisplay() {
    if (!selectedModel) return;

    const pos = selectedModel.position;
    const rot = selectedModel.rotation;
    const scale = selectedModel.scale;

    document.getElementById('posX').value = pos.x.toFixed(2);
    document.getElementById('posY').value = pos.y.toFixed(2);
    document.getElementById('posZ').value = pos.z.toFixed(2);

    document.getElementById('rotX').value = (rot.x * 180 / Math.PI).toFixed(2);
    document.getElementById('rotY').value = (rot.y * 180 / Math.PI).toFixed(2);
    document.getElementById('rotZ').value = (rot.z * 180 / Math.PI).toFixed(2);

    document.getElementById('scaleX').value = scale.x.toFixed(2);
    document.getElementById('scaleY').value = scale.y.toFixed(2);
    document.getElementById('scaleZ').value = scale.z.toFixed(2);
}

function applyModelTransform() {
    if (!selectedModel) return;

    const posX = parseFloat(document.getElementById('posX').value) || 0;
    const posY = parseFloat(document.getElementById('posY').value) || 0;
    const posZ = parseFloat(document.getElementById('posZ').value) || 0;

    const rotX = (parseFloat(document.getElementById('rotX').value) || 0) * Math.PI / 180;
    const rotY = (parseFloat(document.getElementById('rotY').value) || 0) * Math.PI / 180;
    const rotZ = (parseFloat(document.getElementById('rotZ').value) || 0) * Math.PI / 180;

    const scaleX = parseFloat(document.getElementById('scaleX').value) || 1;
    const scaleY = parseFloat(document.getElementById('scaleY').value) || 1;
    const scaleZ = parseFloat(document.getElementById('scaleZ').value) || 1;

    selectedModel.position.set(posX, posY, posZ);
    selectedModel.rotation.set(rotX, rotY, rotZ);
    selectedModel.scale.set(scaleX, scaleY, scaleZ);

    // Emit changes to other users
    socket.emit('modelMoved', {
        workspaceId: currentWorkspaceId,
        modelId: selectedModel.userData.id,
        position: { x: posX, y: posY, z: posZ },
        rotation: { x: rotX, y: rotY, z: rotZ },
        scale: { x: scaleX, y: scaleY, z: scaleZ }
    });
}

function focusOnModel(modelId) {
    const model = threeDModels[modelId];
    if (!model) return;

    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 3;

    // Animate camera to focus on model
    const targetPosition = new THREE.Vector3(
        center.x + distance,
        center.y + distance * 0.5,
        center.z + distance
    );

    // Smooth camera transition
    animateCamera(targetPosition, center);
}

function animateCamera(targetPosition, targetLookAt) {
    const startPosition = camera.position.clone();
    const startTarget = controls.target.clone();

    const duration = 1000; // 1 second
    const startTime = Date.now();

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Smooth easing
        const eased = 1 - Math.pow(1 - progress, 3);

        camera.position.lerpVectors(startPosition, targetPosition, eased);
        controls.target.lerpVectors(startTarget, targetLookAt, eased);
        controls.update();

        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }

    animate();
}

function deleteModel(modelId) {
    if (confirm('Are you sure you want to delete this 3D model?')) {
        const model = threeDModels[modelId];
        if (model) {
            scene.remove(model);
            delete threeDModels[modelId];

            if (selectedModel === model) {
                selectedModel = null;
                document.getElementById('modelControls').style.display = 'none';
            }

            updateModelsListDisplay();

            // Notify other users
            socket.emit('modelDeleted', {
                workspaceId: currentWorkspaceId,
                modelId: modelId
            });
        }
    }
}

// Setup model control inputs
function setupModelControls() {
    const inputs = ['posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'scaleX', 'scaleY', 'scaleZ'];

    inputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('change', applyModelTransform);
            input.addEventListener('input', applyModelTransform);
        }
    });

    // Focus button
    document.getElementById('focusModelBtn')?.addEventListener('click', () => {
        if (selectedModel) {
            focusOnModel(selectedModel.userData.id);
        }
    });

    // Delete button
    document.getElementById('deleteModelBtn')?.addEventListener('click', () => {
        if (selectedModel) {
            deleteModel(selectedModel.userData.id);
        }
    });
}

// Enhanced mouse interaction for both notes and 3D models
let draggingNote = null;
let isDragging = false;
let draggingModel = null;
let isDraggingModel = false;
let dragStartTime = 0;
let dragStartPosition = { x: 0, y: 0 };
let isControlsActive = false;

window.addEventListener('mousedown', (e) => {
    // Check if clicked on UI elements
    if (e.target.closest('.ui-panel') || e.target.closest('button') || e.target.closest('input')) {
        return;
    }

    // Don't interfere with orbit controls when right-clicking or middle-clicking
    if (e.button !== 0) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Check for 3D models first
    const modelMeshes = [];
    Object.values(threeDModels).forEach(model => {
        model.traverse(child => {
            if (child.isMesh) {
                modelMeshes.push(child);
            }
        });
    });

    const modelIntersects = raycaster.intersectObjects(modelMeshes);

    if (modelIntersects.length > 0) {
        // Find the top-level model object
        let targetModel = modelIntersects[0].object;
        while (targetModel.parent && !targetModel.userData.type) {
            targetModel = targetModel.parent;
        }

        if (targetModel.userData.type === '3dmodel') {
            draggingModel = targetModel;
            dragStartTime = Date.now();
            dragStartPosition = { x: e.clientX, y: e.clientY };
            selectModel(targetModel.userData.id);
            console.log('🎯 Started dragging model:', targetModel.userData.name);
            e.preventDefault();
            return;
        }
    }

    // Check for sticky notes
    const noteMeshes = Object.values(stickyNotes).map(note => note.mesh);
    const noteIntersects = raycaster.intersectObjects(noteMeshes);

    if (noteIntersects.length > 0) {
        draggingNote = noteIntersects[0].object;
        dragStartTime = Date.now();
        dragStartPosition = { x: e.clientX, y: e.clientY };
        console.log('📝 Started dragging note');
        e.preventDefault();
    }
});

window.addEventListener('mousemove', (e) => {
    // Handle model dragging
    if (draggingModel) {
        const dragDistance = Math.sqrt(
            Math.pow(e.clientX - dragStartPosition.x, 2) +
            Math.pow(e.clientY - dragStartPosition.y, 2)
        );

        if (dragDistance > 5 && !isDraggingModel) {
            isDraggingModel = true;
            controls.enabled = false; // Disable orbit controls while dragging
            console.log('🎯 Model drag started');
        }

        if (isDraggingModel) {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            const intersects = raycaster.intersectObject(plane);
            if (intersects.length > 0) {
                const point = intersects[0].point;
                const oldY = draggingModel.position.y;
                draggingModel.position.set(point.x, oldY, point.z);

                // Update controls display if this is the selected model
                if (selectedModel === draggingModel) {
                    updateModelControlsDisplay();
                }
            }
        }
        return;
    }

    // Handle note dragging
    if (draggingNote) {
        const dragDistance = Math.sqrt(
            Math.pow(e.clientX - dragStartPosition.x, 2) +
            Math.pow(e.clientY - dragStartPosition.y, 2)
        );

        if (dragDistance > 5 && !isDragging) {
            isDragging = true;
            controls.enabled = false; // Disable orbit controls while dragging
            console.log('📝 Note drag started');
        }

        if (isDragging) {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            const intersects = raycaster.intersectObject(plane);
            if (intersects.length > 0) {
                const point = intersects[0].point;
                const stickyNote = draggingNote.userData.stickyNote;
                stickyNote.setPosition(point);

                socket.emit('updateNote', {
                    noteId: stickyNote.id,
                    updates: {
                        position: { x: point.x, y: point.y, z: point.z }
                    }
                });
            }
        }
    }
});

window.addEventListener('mouseup', (e) => {
    if (draggingModel) {
        if (isDraggingModel) {
            console.log('🎯 Model drag ended');
            // Send final position to server
            socket.emit('modelMoved', {
                workspaceId: currentWorkspaceId,
                modelId: draggingModel.userData.id,
                position: {
                    x: draggingModel.position.x,
                    y: draggingModel.position.y,
                    z: draggingModel.position.z
                }
            });
        }
        isDraggingModel = false;
        draggingModel = null;
        controls.enabled = true; // Re-enable orbit controls
    }

    if (draggingNote) {
        if (isDragging) {
            console.log('📝 Note drag ended');
        }
        isDragging = false;
        draggingNote = null;
        controls.enabled = true; // Re-enable orbit controls
    }
});

window.addEventListener('click', (e) => {
    // Don't create notes while dragging
    if (isDragging || isDraggingModel) {
        return;
    }

    // Check if clicked on UI elements
    if (e.target.closest('.ui-panel') || e.target.closest('button') || e.target.closest('input')) {
        return;
    }

    // Small delay to distinguish from drag operations
    setTimeout(() => {
        if (isDragging || isDraggingModel) return;

        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        // Check if clicking on existing objects
        const allMeshes = [
            ...Object.values(stickyNotes).map(note => note.mesh)
        ];

        // Add all model meshes
        Object.values(threeDModels).forEach(model => {
            model.traverse(child => {
                if (child.isMesh) {
                    allMeshes.push(child);
                }
            });
        });

        const intersects = raycaster.intersectObjects(allMeshes);

        if (intersects.length === 0) {
            // Create sticky note on empty space
            const planeIntersects = raycaster.intersectObject(plane);
            if (planeIntersects.length > 0) {
                const point = planeIntersects[0].point;
                console.log('📝 Creating new note at:', point);

                socket.emit('createNote', {
                    text: "New Note",
                    position: { x: point.x, y: point.y, z: point.z },
                    workspaceId: currentWorkspaceId
                });
            }
        }
    }, 50);
});

window.addEventListener('dblclick', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const meshes = Object.values(stickyNotes).map(note => note.mesh);
    const intersects = raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
        const stickyNote = intersects[0].object.userData.stickyNote;
        if (stickyNote) {
            const newText = prompt('Edit note:', stickyNote.getText());
            if (newText && newText.trim()) {
                stickyNote.setText(newText.trim());

                socket.emit('updateNote', {
                    noteId: stickyNote.id,
                    updates: { text: newText.trim() }
                });
            }
        }
    }
});

// Helper functions
function createOtherUser(id, userData) {
    if (otherUsers[id]) return;

    const geometry = new THREE.SphereGeometry(0.2, 32, 32);
    const color = userData.avatar?.color || '#ff0000';
    const material = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
        userData.position?.x || 0,
        userData.position?.y || 0.2,
        userData.position?.z || 0
    );
    mesh.castShadow = true;
    scene.add(mesh);

    // Add username label
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(userData.userInfo?.username || 'User', 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(2, 0.5, 1);
    sprite.position.set(0, 0.8, 0);

    mesh.add(sprite);
    otherUsers[id] = mesh;
}

function addToOnlineUsers(socketId, userData) {
    onlineUsers[socketId] = userData;
    updateOnlineUsersList();
}

function removeFromOnlineUsers(socketId) {
    delete onlineUsers[socketId];
    updateOnlineUsersList();
}

function updateOnlineUsersList() {
    const usersList = document.getElementById('usersList');
    if (!usersList) return;

    if (Object.keys(onlineUsers).length === 0) {
        usersList.innerHTML = '<div style="color: #666; font-size: 12px;">No other users online</div>';
        return;
    }

    usersList.innerHTML = '';

    Object.entries(onlineUsers).forEach(([id, user]) => {
        const userDiv = document.createElement('div');
        userDiv.className = 'online-user';

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'user-avatar';
        avatarDiv.style.backgroundColor = user.avatar?.color || '#4ecdc4';
        avatarDiv.textContent = (user.userInfo?.username || 'U')[0].toUpperCase();

        const nameDiv = document.createElement('div');
        nameDiv.textContent = user.userInfo?.username || 'Anonymous';
        nameDiv.style.fontSize = '12px';

        const statusDiv = document.createElement('div');
        statusDiv.style.width = '8px';
        statusDiv.style.height = '8px';
        statusDiv.style.borderRadius = '50%';
        statusDiv.style.backgroundColor = '#27ae60';
        statusDiv.style.marginLeft = 'auto';

        userDiv.appendChild(avatarDiv);
        userDiv.appendChild(nameDiv);
        userDiv.appendChild(statusDiv);
        usersList.appendChild(userDiv);
    });
}

// StickyNote class
class StickyNote {
    constructor(position, text = "New Note", id = null) {
        this.id = id || crypto.randomUUID();
        this.text = text;
        this.position = position.clone();
        this.mesh = null;
        this.canvas = null;
        this.texture = null;

        this.createMesh();
        this.updateVisual();

        scene.add(this.mesh);
        stickyNotes[this.id] = this;
    }

    createMesh() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 512;
        this.canvas.height = 320;

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.needsUpdate = true;

        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            side: THREE.DoubleSide,
            transparent: true
        });
        const geometry = new THREE.PlaneGeometry(2, 1.2);
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(this.position);
        this.mesh.position.y += 0.6;

        this.mesh.userData.stickyNote = this;
        this.mesh.userData.id = this.id;
        this.mesh.userData.type = 'stickyNote';
    }

    updateVisual() {
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Note background
        ctx.fillStyle = '#ffff88';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Border
        ctx.strokeStyle = '#e6d55a';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);

        // Text
        ctx.fillStyle = '#000';
        ctx.font = 'bold 36px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // Simple text wrapping
        const words = this.text.split(' ');
        const maxWidth = this.canvas.width - 40;
        let line = '';
        let y = 40;

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line, 20, y);
                line = words[n] + ' ';
                y += 45;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, 20, y);

        this.texture.needsUpdate = true;
    }

    setText(newText) {
        this.text = newText;
        this.updateVisual();
    }

    setPosition(newPosition) {
        this.position.copy(newPosition);
        this.mesh.position.copy(newPosition);
        this.mesh.position.y += 0.6;
    }

    getText() {
        return this.text;
    }

    destroy() {
        if (this.mesh) {
            scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            if (this.texture) {
                this.texture.dispose();
            }
        }
        delete stickyNotes[this.id];
    }
}

function createStickyNote(position, text = "New Note", id = null) {
    return new StickyNote(position, text, id);
}

// Input handlers for avatar movement (only when not using orbit controls)
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return; // Don't move when typing in inputs

    if (e.key == 'ArrowUp') moveZ = -0.05;
    if (e.key == 'ArrowDown') moveZ = 0.05;
    if (e.key == "ArrowLeft") moveX = -0.05;
    if (e.key == 'ArrowRight') moveX = 0.05;

    if (e.key === 'c' || e.key === 'C') {
        useAvatarMovement = !useAvatarMovement;
        console.log('🎮 Avatar movement:', useAvatarMovement ? 'enabled' : 'disabled');

        if (useAvatarMovement) {
            // When switching to avatar mode, just update the orbit target
            // Don't force camera position - let user maintain their current view
            controls.target.copy(avatar.position);
            console.log('🎯 Camera now orbits around avatar');
        } else {
            // When disabling avatar mode, set target back to origin
            controls.target.set(0, 0, 0);
            console.log('🎯 Camera now orbits around origin');
        }
        controls.update();
    }
});

document.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'ArrowDown'].includes(e.key)) moveZ = 0;
    if (['ArrowLeft', 'ArrowRight'].includes(e.key)) moveX = 0;
});

// Button handlers
document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    localStorage.removeItem('isDemo');
    localStorage.removeItem('currentWorkspaceId');
    window.location.href = 'index.html';
});

document.getElementById('backBtn')?.addEventListener('click', () => {
    window.location.href = 'workspace-selector.html';
});

document.getElementById('shareBtn')?.addEventListener('click', () => {
    const shareText = `Join my 3D Workspace!\nWorkspace ID: ${currentWorkspaceId}\nOpen: ${window.location.origin}`;

    if (navigator.share) {
        navigator.share({
            title: '3D Collaborative Workspace',
            text: shareText,
            url: window.location.origin
        });
    } else {
        navigator.clipboard.writeText(shareText).then(() => {
            alert('Workspace sharing info copied to clipboard!');
        }).catch(() => {
            prompt('Share this workspace:', shareText);
        });
    }
});

document.getElementById('copyIdBtn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(currentWorkspaceId).then(() => {
        const btn = document.getElementById('copyIdBtn');
        if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            setTimeout(() => {
                btn.innerHTML = originalText;
            }, 2000);
        }
    });
});

document.getElementById('saveBtn')?.addEventListener('click', () => {
    const notes = Object.values(stickyNotes).map(note => ({
        id: note.id,
        text: note.getText(),
        position: {
            x: note.position.x,
            y: note.position.y,
            z: note.position.z
        }
    }));

    const models = Object.values(threeDModels).map(model => ({
        id: model.userData.id,
        name: model.userData.name,
        position: {
            x: model.position.x,
            y: model.position.y,
            z: model.position.z
        },
        rotation: {
            x: model.rotation.x,
            y: model.rotation.y,
            z: model.rotation.z
        },
        scale: {
            x: model.scale.x,
            y: model.scale.y,
            z: model.scale.z
        }
    }));

    socket.emit('saveWorkspace', {
        workspaceId: currentWorkspaceId,
        notes: notes,
        models: models
    });

    const btn = document.getElementById('saveBtn');
    if (btn) {
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ Saved!';
        setTimeout(() => {
            btn.innerHTML = originalText;
        }, 2000);
    }
});

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    if (useAvatarMovement) {
        // Move avatar
        avatar.position.x += moveX;
        avatar.position.z += moveZ;

        // Update controls target to follow avatar, but don't override camera position
        // This allows free rotation around the avatar
        controls.target.copy(avatar.position);

        // Send position updates
        socket.emit('updatePosition', {
            x: avatar.position.x,
            y: avatar.position.y,
            z: avatar.position.z
        });
    }

    // Make notes always face camera
    Object.values(stickyNotes).forEach(note => {
        note.mesh.lookAt(camera.position);
    });

    controls.update();

    renderer.render(scene, camera);
}

// Window resize handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize everything
function init() {
    setupFileUpload();
    setupModelControls();
    animate();

    console.log(' 3D Workspace initialized');
    console.log(' Controls:');
    console.log('  - Right-click + drag: Rotate camera');
    console.log('  - Scroll: Zoom in/out');
    console.log('  - Left-click + drag models: Move models');
    console.log('  - Left-click empty space: Create sticky note');
    console.log('  - Double-click notes: Edit text');
    console.log('  - Press C: Toggle avatar movement mode');
}

// Start when page loads
window.addEventListener('load', init);

// Make functions globally available for debugging and dynamic calls
window.selectModel = selectModel;
window.focusOnModel = focusOnModel;
window.deleteModel = deleteModel;
window.loadThreeDModel = loadThreeDModel;
window.selectedModel = () => selectedModel;
window.threeDModels = threeDModels;
window.scene = scene;
window.camera = camera;
window.controls = controls;

console.log(' 3D Workspace module loaded successfully!');