// public/javascript/chess_game.js
const socket = io();
const chess = new Chess();

class ChessGameClient {
  constructor() {
    this.initializeElements();
    this.initializeGameState();
    this.setupEventListeners();
  }

  initializeElements() {
    this.boardElement = document.querySelector('.chessboard');
    this.playerInfo = document.querySelector('#player-info');
    this.gameStatus = document.querySelector('#game-status');
    this.whiteTimerElement = document.querySelector('#white-timer');
    this.blackTimerElement = document.querySelector('#black-timer');
  }

  initializeGameState() {
    this.playerRole = null;         // 'w', 'b', or null/spectator
    this.draggedPiece = null;
    this.localTimers = { white: 600, black: 600 };

    // Correct Unicode mapping (lowercase: black, uppercase: white)
    this.PIECE_UNICODE = {
        k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟',  // Black
        K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟'   // White (same solid icons)
    };


    this.renderBoard();
  }

  setupEventListeners() {
    this.setupSocketListeners();
    this.setupControlButtonListeners();
  }

  setupSocketListeners() {
    socket.on('playerRole', this.handlePlayerRole.bind(this));
    socket.on('spectatorRole', () => {
      this.playerRole = 'spectator';
      this.playerInfo.textContent = 'You are watching as a spectator';
    });
    socket.on('move', this.handleMove.bind(this));
    socket.on('gameState', this.handleGameState.bind(this));
    socket.on('gameOver', this.handleGameOver.bind(this));
    socket.on('timeUp', this.handleTimeUp.bind(this));
    socket.on('drawOffered', this.handleDrawOffer.bind(this));
    socket.on('timerUpdate', (timers) => {
      this.localTimers = timers;
      this.updateTimerDisplay();
    });
    socket.on('invalidMove', (msg) => {
      this.gameStatus.textContent = msg;
      setTimeout(() => (this.gameStatus.textContent = ''), 1500);
    });
    socket.on('playerDisconnected', (color) => {
      this.gameStatus.textContent = `Player ${color} disconnected.`;
    });
  }

  setupControlButtonListeners() {
    document.querySelector('#offer-draw').addEventListener('click', () => {
      socket.emit('offerDraw');
    });

    document.querySelector('#resign').addEventListener('click', () => {
      socket.emit('resign');
    });
  }

  handlePlayerRole(role) {
    this.playerRole = role; // 'w' or 'b'
    this.playerInfo.textContent = `You are playing as ${role === 'w' ? 'White' : 'Black'}`;
    this.renderBoard();
  }

  handleMove(gameData) {
    chess.move(gameData.move);
    this.localTimers = gameData.timers;
    this.updateTimerDisplay();
    this.renderBoard();
  }

  handleGameState(gameState) {
    chess.load(gameState.fen);
    this.localTimers = gameState.timers;
    this.updateTimerDisplay();
    this.renderBoard();
  }

  handleGameOver(message) {
    this.gameStatus.textContent = message;
    this.playerRole = this.playerRole === 'spectator' ? 'spectator' : null;
  }

  handleTimeUp(color) {
    // color received from server can be 'w'/'b' or 'white'/'black' based on server
    const isWhite = color === 'w' || color === 'white';
    this.gameStatus.textContent = `Time's up! ${isWhite ? 'Black' : 'White'} wins on time`;
    this.localTimers = { white: 0, black: 0 };
    this.updateTimerDisplay();
    this.playerRole = this.playerRole === 'spectator' ? 'spectator' : null;
  }

  handleDrawOffer() {
    const accept = confirm('Opponent offers a draw. Accept?');
    if (accept) {
      socket.emit('acceptDraw');
    }
  }

  renderBoard() {
    const board = chess.board(); // 8x8 array
    this.boardElement.innerHTML = '';

    // If black, flip perspective
    const rows = this.playerRole === 'b' ? [...board].reverse() : board;

    rows.forEach((row, rowIndex) => {
      const cols = this.playerRole === 'b' ? [...row].reverse() : row;

      cols.forEach((square, squareIndex) => {
        const actualRow = this.playerRole === 'b' ? 7 - rowIndex : rowIndex;
        const actualCol = this.playerRole === 'b' ? 7 - squareIndex : squareIndex;
        const squareEl = this.createSquareElement(actualRow, actualCol, square);
        this.boardElement.appendChild(squareEl);
      });
    });
  }

  createSquareElement(rowIndex, colIndex, square) {
    const squareElement = document.createElement('div');
    const algebraicSquare = `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}`;

    squareElement.classList.add(
      'square',
      (rowIndex + colIndex) % 2 === 0 ? 'light' : 'dark'
    );
    squareElement.dataset.square = algebraicSquare;

    this.setupSquareDragEvents(squareElement, algebraicSquare);

    if (square) {
      const pieceElement = this.createPieceElement(square);
      squareElement.appendChild(pieceElement);
    }

    return squareElement;
  }

  setupSquareDragEvents(squareElement, algebraicSquare) {
    squareElement.addEventListener('dragover', (e) => e.preventDefault());
    squareElement.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this.draggedPiece) {
        const move = {
          from: this.draggedPiece.parentElement.dataset.square,
          to: algebraicSquare,
          promotion: 'q', // auto-queen
        };
        socket.emit('move', move);
        this.draggedPiece = null;
      }
    });
  }

  createPieceElement(square) {
    const pieceElement = document.createElement('div');
    pieceElement.classList.add('piece', square.color === 'w' ? 'white' : 'black');

    // Key for unicode map: white uses uppercase, black uses lowercase
    const key = square.color === 'w' ? square.type.toUpperCase() : square.type;
    pieceElement.innerText = this.PIECE_UNICODE[key];

    pieceElement.setAttribute('draggable', 'true');

    this.setupPieceDragEvents(pieceElement, square);
    this.setupPieceTouchEvents(pieceElement, square);

    return pieceElement;
  }

  setupPieceDragEvents(pieceElement, square) {
    pieceElement.addEventListener('dragstart', (e) => {
      if (this.playerRole !== square.color) {
        e.preventDefault();
        return;
      }
      this.draggedPiece = pieceElement;
      pieceElement.classList.add('dragging');
    });

    pieceElement.addEventListener('dragend', () => {
      pieceElement.classList.remove('dragging');
    });
  }

  setupPieceTouchEvents(pieceElement, square) {
    pieceElement.addEventListener(
      'touchstart',
      (e) => {
        if (this.playerRole !== square.color) return;
        e.preventDefault();
        this.draggedPiece = pieceElement;
      },
      { passive: false }
    );

    pieceElement.addEventListener(
      'touchend',
      (e) => {
        if (!this.draggedPiece) return;
        e.preventDefault();
        const t = e.changedTouches[0];
        const targetElement = document.elementFromPoint(t.clientX, t.clientY);

        if (targetElement && targetElement.closest('.square')) {
          const move = {
            from: this.draggedPiece.parentElement.dataset.square,
            to: targetElement.closest('.square').dataset.square,
            promotion: 'q',
          };
          socket.emit('move', move);
          this.draggedPiece = null;
        }
      },
      { passive: false }
    );
  }

  updateTimerDisplay() {
    this.whiteTimerElement.textContent = this.formatTime(this.localTimers.white);
    this.blackTimerElement.textContent = this.formatTime(this.localTimers.black);

    this.whiteTimerElement.closest('.timer').classList.toggle(
      'low-time',
      this.localTimers.white <= 60
    );
    this.blackTimerElement.closest('.timer').classList.toggle(
      'low-time',
      this.localTimers.black <= 60
    );
  }

  formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
}

// Boot
new ChessGameClient();
