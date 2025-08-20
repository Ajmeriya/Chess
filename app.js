// app.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

class ChessGame {
  constructor() {
    this.chess = new Chess();
    this.players = { white: null, black: null }; // socket ids
    this.timers = { white: 600, black: 600 };    // 10 mins each
    this.timerIntervals = {};
  }

  startTimer(color) {
    // color: 'white' or 'black'
    this.stopTimers();
    this.timerIntervals[color] = setInterval(() => {
      this.timers[color]--;
      io.emit('timerUpdate', this.timers);
      if (this.timers[color] <= 0) {
        this.stopTimers();
        io.emit('timeUp', color[0]); // 'w' or 'b' feel free to keep 'white'/'black'
      }
    }, 1000);
  }

  stopTimers() {
    Object.values(this.timerIntervals).forEach((interval) => clearInterval(interval));
    this.timerIntervals = {};
  }

  reset() {
    this.chess = new Chess();
    this.timers = { white: 600, black: 600 };
    this.stopTimers();
  }
}

const game = new ChessGame();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.render('index', { title: 'Chess Game' });
});

io.on('connection', (socket) => {
  // Assign roles
  if (!game.players.white) {
    game.players.white = socket.id;
    socket.emit('playerRole', 'w');
    socket.playerRole = 'w';
  } else if (!game.players.black) {
    game.players.black = socket.id;
    socket.emit('playerRole', 'b');
    socket.playerRole = 'b';
    // Start white's timer when both players are in
    game.startTimer('white');
  } else {
    socket.emit('spectatorRole');
    socket.playerRole = 'spectator';
  }

  // Send current state
  socket.emit('gameState', {
    fen: game.chess.fen(),
    timers: game.timers,
  });

  socket.on('move', (move) => {
    try {
      // Move permission: only the side to move can send a move
      const turnColor = game.chess.turn() === 'w' ? 'white' : 'black';
      const allowedSocketId = game.players[turnColor];
      if (socket.id !== allowedSocketId) return;

      // Ensure promotion default (e.g., to queen)
      const serverMove = {
        from: move.from,
        to: move.to,
        promotion: move.promotion || 'q',
      };

      const result = game.chess.move(serverMove);
      if (!result) {
        socket.emit('invalidMove', 'Invalid move');
        return;
      }

      // Switch timers
      game.stopTimers();
      const nextColor = turnColor === 'white' ? 'black' : 'white';
      game.startTimer(nextColor);

      // Broadcast updated state
      io.emit('move', {
        move: serverMove,
        fen: game.chess.fen(),
        timers: game.timers,
      });

      // End conditions
      if (game.chess.in_checkmate()) {
        game.stopTimers();
        io.emit(
          'gameOver',
          `Checkmate! ${turnColor === 'white' ? 'White' : 'Black'} wins`
        );
      } else if (game.chess.in_stalemate()) {
        game.stopTimers();
        io.emit('gameOver', 'Stalemate!');
      } else if (game.chess.in_draw()) {
        game.stopTimers();
        io.emit('gameOver', 'Draw!');
      }
    } catch (err) {
      console.error('Move error:', err);
      socket.emit('invalidMove', err.message);
    }
  });

  socket.on('offerDraw', () => {
    socket.broadcast.emit('drawOffered');
  });

  socket.on('acceptDraw', () => {
    game.stopTimers();
    io.emit('gameOver', 'Draw by agreement');
  });

  socket.on('resign', () => {
    game.stopTimers();
    const resigningColor =
      socket.id === game.players.white ? 'White' :
      socket.id === game.players.black ? 'Black' :
      'Player';
    const winner =
      resigningColor === 'White' ? 'Black' :
      resigningColor === 'Black' ? 'White' : 'Opponent';
    io.emit('gameOver', `${resigningColor} resigns. ${winner} wins!`);
  });

  socket.on('disconnect', () => {
    // Clean up if a player leaves
    if (socket.id === game.players.white) {
      game.players.white = null;
      game.stopTimers();
      io.emit('playerDisconnected', 'white');
    } else if (socket.id === game.players.black) {
      game.players.black = null;
      game.stopTimers();
      io.emit('playerDisconnected', 'black');
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
