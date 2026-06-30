// Voice I/O: Web Speech API transcription + MediaRecorder audio capture
// Handles microphone access, transcription, and raw audio blob recording

const LANG = 'ru-RU'; // Russian language for Web Speech API
const STOP_LISTEN_TIMEOUT_MS = 10000; // 10s timeout for listening

export class VoiceIO {
  constructor() {
    // Web Speech API setup
    const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    this.recognition.lang = LANG;
    this.recognition.interimResults = false;
    this.recognition.continuous = false; // iOS limitation: no continuous mode

    // MediaRecorder setup (for raw audio capture)
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.mediaStream = null;

    // State tracking
    this.state = 'idle'; // idle | listening | recording | transcribing
    this.transcript = null;
    this.audioBlob = null;
    this.listenTimeout = null;

    this.setupRecognitionHandlers();
  }

  setupRecognitionHandlers() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.state = 'listening';
      this.clearListenTimeout();
      // 10s timeout to stop listening if no speech detected
      this.listenTimeout = setTimeout(() => this.stop(), STOP_LISTEN_TIMEOUT_MS);
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          this.transcript = transcript;
        } else {
          interim += transcript;
        }
      }
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      this.state = 'idle';
      this.clearListenTimeout();
    };

    this.recognition.onend = () => {
      this.state = 'idle';
      this.clearListenTimeout();
    };
  }

  clearListenTimeout() {
    if (this.listenTimeout) {
      clearTimeout(this.listenTimeout);
      this.listenTimeout = null;
    }
  }

  async startListening() {
    if (!this.recognition) {
      throw new Error('Web Speech API not supported');
    }
    this.transcript = null;
    this.recognition.start();
  }

  stop() {
    if (this.recognition && this.state !== 'idle') {
      this.recognition.stop();
    }
  }

  async startRecording() {
    try {
      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(this.mediaStream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        // Create blob from recorded chunks
        this.audioBlob = new Blob(this.audioChunks, { type: 'audio/mp4' });
      };

      this.state = 'recording';
      this.mediaRecorder.start();
    } catch (err) {
      console.error('Failed to start recording:', err);
      this.state = 'idle';
      throw err;
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.state === 'recording') {
      this.mediaRecorder.stop();
      this.state = 'idle';

      // Stop all media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      return this.audioBlob;
    }
    return null;
  }

  async getTranscript() {
    return this.transcript;
  }

  getState() {
    return this.state;
  }
}

export async function createVoiceIO() {
  return new VoiceIO();
}
