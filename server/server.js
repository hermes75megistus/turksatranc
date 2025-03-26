cat <<'EOF' > /var/www/turksatranc/server/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Define default environment variables if not set
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/turksatranc';
const SESSION_SECRET = process.env.SESSION_SECRET || 'turksatranc-secure-session-key';
const PORT = process.env.PORT || 5000;

// Uygulama başlatma
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Mongoose Yapılandırması
mongoose.set('strictQuery', false); // Deprecation uyarısını önlemek için
mongoose.set('debug', process.env.NODE_ENV !== 'production'); // Debug modunu sadece production olmayan ortamlarda aktifleştir

// MongoDB bağlantısı
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB bağlantısı başarılı: ' + mongoose.connection.readyState))
.catch(err => console.error('MongoDB bağlantı hatası detayları:', err));

// User model
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  registeredAt: { type: Date, default: Date.now },
  elo: { type: Number, default: 1200 },
  gamesPlayed: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 }
});

const User = mongoose.model('User', UserSchema);

// Game model
const GameSchema = new mongoose.Schema({
  whitePlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  blackPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  result: { type: String, enum: ['white', 'black', 'draw', 'ongoing'], default: 'ongoing' },
  pgn: { type: String, default: '' },
  fen: { type: String, default: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
  timeControl: { type: Number, default: 10 }, // dakika cinsinden
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  moves: [{ 
    from: String, 
    to: String, 
    timestamp: { type: Date, default: Date.now } 
  }]
});

const Game = mongoose.model('Game', GameSchema);

// Middleware ayarları
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rate limiting için middleware
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 dakika
const RATE_LIMIT_MAX = 5; // maksimum deneme sayısı

const rateLimiter = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  // Geçerli penceredeki giriş denemelerini temizle
  if (loginAttempts.has(ip)) {
    const attempts = loginAttempts.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);
    loginAttempts.set(ip, attempts);
    
    if (attempts.length >= RATE_LIMIT_MAX) {
      return res.status(429).json({ 
        error: 'Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.'
      });
    }
  }
  
  next();
};

// Session yönetimi
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: MONGODB_URI,
    ttl: 60 * 60 * 24 // 1 gün
  }),
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 gün
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' // Production'da HTTPS kullan
  }
}));

// Auth middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  
  if (req.xhr || req.headers.accept && req.headers.accept.indexOf('json') > -1) {
    return res.status(401).json({ error: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
  }
  
  res.redirect('/giris');
};

// Express error handling middleware
app.use((err, req, res, next) => {
  console.error('Express hata yakalama:', err);
  res.status(500).json({ error: 'Sunucu hatası', details: err.message });
});

// Routes - Giriş ve Kayıt İşlemleri
app.get('/giris', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/giris.html'));
});

app.get('/kayit', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/kayit.html'));
});

app.post('/api/kayit', async (req, res) => {
  try {
    console.log('Kayıt isteği alındı:', req.body);
    const { username, email, password, passwordConfirm } = req.body;
    
    // Temel doğrulama işlemleri
    if (!username || !email || !password || !passwordConfirm) {
      return res.status(400).json({ error: 'Tüm alanları doldurunuz' });
    }
    
    // Kullanıcı adı ve email formatını kontrol et
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ 
        error: 'Kullanıcı adı 3-20 karakter arasında olmalı ve sadece harf, rakam ve alt çizgi içermelidir'
      });
    }
    
    if (!/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Geçerli bir e-posta adresi giriniz' });
    }
    
    // Parola kontrolleri
    if (password.length < 6) {
      return res.status(400).json({ error: 'Parola en az 6 karakter olmalıdır' });
    }
    
    if (password !== passwordConfirm) {
      return res.status(400).json({ error: 'Parolalar eşleşmiyor' });
    }
    
    // Kullanıcı adı veya e-posta kontrolü
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Bu kullanıcı adı veya e-posta adresi zaten kullanılıyor' });
    }
    
    // Parola hashleme
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Yeni kullanıcı oluşturma
    const newUser = new User({
      username,
      email,
      password: hashedPassword
    });
    
    await newUser.save();
    console.log('Yeni kullanıcı kaydedildi:', username);
    
    // Oturum başlatma
    req.session.userId = newUser._id;
    
    res.status(201).json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ error: 'Kayıt sırasında bir hata oluştu', details: error.message });
  }
});

app.post('/api/giris', rateLimiter, async (req, res) => {
  try {
    console.log('Giriş isteği alındı:', req.body);
    const { username, password } = req.body;
    
    // Girdi doğrulama
    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve parola gereklidir' });
    }
    
    // Kullanıcıyı bulma
    const user = await User.findOne({ username });
    if (!user) {
      // Rate limiter için giriş denemesini kaydet
      const ip = req.ip;
      const attempts = loginAttempts.get(ip) || [];
      attempts.push(Date.now());
      loginAttempts.set(ip, attempts);
      
      return res.status(400).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }
    
    // Parola kontrolü
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Rate limiter için giriş denemesini kaydet
      const ip = req.ip;
      const attempts = loginAttempts.get(ip) || [];
      attempts.push(Date.now());
      loginAttempts.set(ip, attempts);
      
      return res.status(400).json({ error: 'Geçersiz kullanıcı adı veya parola' });
    }
    
    // Oturum başlatma
    req.session.userId = user._id;
    console.log('Kullanıcı girişi yapıldı:', username);
    
    res.json({ success: true, redirect: '/' });
  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ error: 'Giriş sırasında bir hata oluştu', details: error.message });
  }
});

app.get('/api/cikis', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Çıkış hatası:', err);
      return res.status(500).json({ error: 'Çıkış yapılırken bir hata oluştu' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, redirect: '/giris' });
  });
});

// Kullanıcı profil sayfası
app.get('/profil', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profil.html'));
});

app.get('/api/kullanici', isAuthenticated, async (req, res) => {
  try {
    console.log('Kullanıcı bilgisi isteniyor, userId:', req.session.userId);
    const user = await User.findById(req.session.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    console.log('Kullanıcı bilgisi gönderiliyor:', user.username);
    res.json(user);
  } catch (error) {
    console.error('Kullanıcı bilgisi alma hatası:', error);
    res.status(500).json({ error: 'Kullanıcı bilgisi alınırken bir hata oluştu', details: error.message });
  }
});

// Şifre değiştirme endpoint'i
app.post('/api/sifre-degistir', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Girdi doğrulama
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Mevcut ve yeni parola gereklidir' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Yeni parola en az 6 karakter olmalıdır' });
    }
    
    // Kullanıcıyı bul
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    // Mevcut parolayı kontrol et
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Mevcut parola hatalı' });
    }
    
    // Yeni parolayı hashle
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Parolayı güncelle
    await User.findByIdAndUpdate(req.session.userId, { password: hashedPassword });
    
    res.json({ success: true, message: 'Parola başarıyla değiştirildi' });
  } catch (error) {
    console.error('Parola değiştirme hatası:', error);
    res.status(500).json({ error: 'Parola değiştirilirken bir hata oluştu' });
  }
});

// Ana sayfa ve diğer sayfalar
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/siralama', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/siralama.html'));
});

app.get('/api/siralama', isAuthenticated, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const searchTerm = req.query.search || '';
    
    let query = {};
    if (searchTerm) {
      query.username = { $regex: searchTerm, $options: 'i' };
    }
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / limit);
    
    const users = await User.find(query)
      .sort({ elo: -1 })
      .skip(skip)
      .limit(limit)
      .select('username elo gamesPlayed wins losses draws');
    
    res.json({ 
      users,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: page,
        limit
      }
    });
  } catch (error) {
    console.error('Sıralama alma hatası:', error);
    res.status(500).json({ error: 'Sıralama alınırken bir hata oluştu', details: error.message });
  }
});

app.get('/gecmis-oyunlar', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/gecmis-oyunlar.html'));
});

app.get('/api/gecmis-oyunlar', isAuthenticated, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const games = await Game.find({
      $or: [
        { whitePlayer: req.session.userId },
        { blackPlayer: req.session.userId }
      ],
      result: { $ne: 'ongoing' }
    })
    .sort({ endTime: -1 })
    .limit(limit)
    .populate('whitePlayer', 'username')
    .populate('blackPlayer', 'username');
    
    res.json(games);
  } catch (error) {
    console.error('Geçmiş oyunlar alma hatası:', error);
    res.status(500).json({ error: 'Geçmiş oyunlar alınırken bir hata oluştu', details: error.message });
  }
});

// Default route
app.get('*', (req, res) => {
  if (req.session.userId) {
    res.redirect('/');
  } else {
    res.redirect('/giris');
  }
});

// Socket.io - Oyun işlemleri
// -------------------------------------------------------------------------------

// Aktif oyuncular ve oyunlar için depo
const waitingPlayers = [];
const activeGames = new Map();
const userSockets = new Map(); // Kullanıcı ID - Socket ID eşleşmesi

// Socket kimlik doğrulama için middleware
io.use((socket, next) => {
  const sessionId = socket.handshake.auth.sessionId || 
                   (socket.request.headers.cookie || '').split('connect.sid=')[1];
  
  if (!sessionId) {
    return next(new Error('authentication_error'));
  }
  
  // Session verilerini çöz ve kullanıcı kimliğini al
  // Not: Bu basitleştirilmiş bir örnektir. Gerçek uygulamada session store'dan
  // session verilerini almanız gerekir.
  socket.request.session = session;
  
  if (socket.request.session && socket.request.session.userId) {
    socket.userId = socket.request.session.userId;
    return next();
  }
  
  return next(new Error('authentication_error'));
});

io.on('connection', async (socket) => {
  console.log(`Yeni bağlantı: ${socket.id}`);
  
  // Tüm socket hatalarını yakalama
  socket.on('error', (error) => {
    console.error('Socket hatası:', error);
  });
  
  // Kullanıcı kimliğini belirle
  socket.on('authenticate', async (userId) => {
    try {
      console.log('Kimlik doğrulama isteği:', userId);
      
      // Socket'ten gelen userId ile session'daki userId'nin eşleşip eşleşmediğini kontrol et
      if (!socket.userId || socket.userId.toString() !== userId.toString()) {
        console.log('Kimlik doğrulama başarısız: Session ve gönderilen userId uyuşmuyor');
        socket.emit('error', { message: 'Kimlik doğrulama başarısız', redirect: '/giris' });
        return;
      }
      
      const user = await User.findById(userId);
      if (user) {
        userSockets.set(userId, socket.id);
        console.log(`Kullanıcı ${user.username} bağlandı`);
      } else {
        console.log('Kimlik doğrulama başarısız: Kullanıcı bulunamadı');
        socket.emit('error', { message: 'Kullanıcı bulunamadı', redirect: '/giris' });
      }
    } catch (error) {
      console.error('Kimlik doğrulama hatası:', error);
      socket.emit('error', { message: 'Kimlik doğrulama hatası', redirect: '/giris' });
    }
  });

  // Oyuncu eşleşme için arama
  socket.on('find_match', async (timeControl) => {
    if (!socket.userId) {
      console.log('Eşleşme isteği reddedildi: Kullanıcı kimliği yok');
      socket.emit('error', { message: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
      return;
    }
    
    console.log(`Oyuncu ${socket.userId} eşleşme arıyor, süre kontrolü: ${timeControl} dakika`);
    
    try {
      const user = await User.findById(socket.userId);
      
  if (!user) {
        console.log('Kullanıcı bulunamadı:', socket.userId);
        socket.emit('error', { message: 'Kullanıcı bulunamadı', redirect: '/giris' });
        return;
      }
      
      // Geçerli bir sayı olduğundan emin ol
      timeControl = parseInt(timeControl) || 10;
      
      // ELO sistemine göre eşleştirme
      // Aynı zaman kontrolüne sahip ve ELO'su benzer bir oyuncu bul
      const waitingPlayerIndex = waitingPlayers.findIndex(p => {
        return p.timeControl === timeControl && 
               Math.abs(p.elo - user.elo) < 200 && // 200 ELO puan farkı toleransı
               p.id.toString() !== socket.userId.toString(); // Kendisiyle eşleşmeyi önle
      });
      
      if (waitingPlayerIndex !== -1) {
        const opponent = waitingPlayers.splice(waitingPlayerIndex, 1)[0];
        const gameId = Math.random().toString(36).substring(2, 15);
        
        // Rastgele renk ataması (beyaz/siyah)
        const randomBoolean = Math.random() < 0.5;
        const whitePlayerId = randomBoolean ? socket.userId : opponent.id;
        const blackPlayerId = randomBoolean ? opponent.id : socket.userId;
        
        const whitePlayer = await User.findById(whitePlayerId);
        const blackPlayer = await User.findById(blackPlayerId);
        
        if (!whitePlayer || !blackPlayer) {
          console.log('Eşleşme başarısız: Oyunculardan biri bulunamadı');
          socket.emit('error', { message: 'Eşleşme başarısız', redirect: '/giris' });
          return;
        }
        
        // Milisaniye cinsinden zaman
        const timeInMilliseconds = timeControl * 60 * 1000;
        
        // Yeni oyun belgesi oluştur
        const newGame = new Game({
          whitePlayer: whitePlayerId,
          blackPlayer: blackPlayerId,
          timeControl: timeControl,
          startTime: new Date()
        });
        
        await newGame.save();
        console.log('Yeni oyun veritabanına kaydedildi:', newGame._id);
        
        // Aktif oyun bilgisi
        activeGames.set(gameId, {
          id: gameId,
          dbId: newGame._id,
          players: [
            { id: whitePlayerId, color: 'white', username: whitePlayer.username },
            { id: blackPlayerId, color: 'black', username: blackPlayer.username }
          ],
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          pgn: '',
          moves: [],
          timeControl: timeControl,
          clocks: {
            [whitePlayerId]: timeInMilliseconds,
            [blackPlayerId]: timeInMilliseconds
          },
          lastMoveTime: Date.now(),
          currentTurn: 'white',
          messages: []
        });
        
        // Her iki oyuncuya da eşleşme bilgisini gönder
        const whiteSocketId = userSockets.get(whitePlayerId);
        const blackSocketId = userSockets.get(blackPlayerId);
        
        console.log('Eşleşme bilgisi gönderiliyor. Beyaz:', whiteSocketId, 'Siyah:', blackSocketId);
        
        if (whiteSocketId) {
          io.to(whiteSocketId).emit('match_found', { 
            gameId, 
            color: 'white',
            timeControl: timeControl,
            opponent: blackPlayer.username
          });
        }
        
        if (blackSocketId) {
          io.to(blackSocketId).emit('match_found', { 
            gameId, 
            color: 'black',
            timeControl: timeControl,
            opponent: whitePlayer.username
          });
        }
        
        console.log(`Eşleşme oluşturuldu: ${gameId} oyuncular: ${whitePlayer.username} ve ${blackPlayer.username}, süre: ${timeControl} dakika`);
      } else {
        // Önce mevcut bekleme listesinden bu kullanıcıyı kaldır
        const existingIndex = waitingPlayers.findIndex(p => p.id.toString() === socket.userId.toString());
        if (existingIndex !== -1) {
          waitingPlayers.splice(existingIndex, 1);
        }
        
        // Oyuncuyu bekleme listesine ekle
        waitingPlayers.push({ 
          id: socket.userId, 
          joinedAt: Date.now(),
          timeControl: timeControl,
          elo: user.elo
        });
        socket.emit('waiting');
        console.log(`Oyuncu ${user.username} bekleme listesine eklendi`);
      }
    } catch (error) {
      console.error('Eşleşme oluşturma hatası:', error);
      socket.emit('error', { message: 'Eşleşme bulunurken bir hata oluştu' });
    }
  });

  // Hamle yapma
  socket.on('move', async ({ gameId, move, fen, pgn }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      console.log('Oyun bulunamadı:', gameId);
      return;
    }
    
    // Hamle yapma sırasını kontrol et
    const player = game.players.find(p => p.id === socket.userId);
    if (!player) {
      console.log('Bu oyuncu bu oyuna ait değil');
      return;
    }
    
    if ((game.currentTurn === 'white' && player.color !== 'white') || 
        (game.currentTurn === 'black' && player.color !== 'black')) {
      console.log('Sıra bu oyuncuda değil');
      return;
    }
    
    try {
      const now = Date.now();
      const timeDiff = now - game.lastMoveTime;
      
      // Oyun durumunu güncelle
      game.moves.push({...move, timestamp: new Date()});
      game.fen = fen;
      game.pgn = pgn;
      
      // Veritabanındaki oyunu güncelle
      await Game.findByIdAndUpdate(game.dbId, {
        fen: fen,
        pgn: pgn,
        $push: { moves: {...move, timestamp: new Date()} }
      });
      
      // Mevcut oyuncunun saatini güncelle
      game.clocks[socket.userId] -= timeDiff;
      
      // Sırayı değiştir
      game.currentTurn = player.color === 'white' ? 'black' : 'white';
      game.lastMoveTime = now;
      
      // Rakibe bildir
      const opponent = game.players.find(p => p.id !== socket.userId);
      if (opponent) {
        const opponentSocketId = userSockets.get(opponent.id);
        if (opponentSocketId) {
          io.to(opponentSocketId).emit('opponent_move', { 
            move, 
            fen, 
            pgn,
            whiteTime: game.clocks[game.players.find(p => p.color === 'white').id],
            blackTime: game.clocks[game.players.find(p => p.color === 'black').id]
          });
        }
      }
    } catch (error) {
      console.error('Hamle işleme hatası:', error);
    }
  });

  // Oyun bitti
  socket.on('game_over', async ({ gameId, result }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      console.log('Oyun bitirme hatası: Oyun bulunamadı');
      return;
    }
    
    try {
      const player = game.players.find(p => p.id === socket.userId);
      if (!player) return;
      
      // Oyun durumunu güncelle
      let gameResult;
      let whitePlayerResult;
      let blackPlayerResult;
      
      if (result === 'checkmate') {
        // Şah mat - hamle yapan oyuncu kazandı
        gameResult = player.color;
        whitePlayerResult = player.color === 'white' ? 'win' : 'loss';
        blackPlayerResult = player.color === 'white' ? 'loss' : 'win';
      } else if (result === 'draw') {
        // Berabere
        gameResult = 'draw';
        whitePlayerResult = 'draw';
        blackPlayerResult = 'draw';
      } else if (result === 'resignation') {
        // İstifa - teslim olan oyuncu kaybetti
        gameResult = player.color === 'white' ? 'black' : 'white';
        whitePlayerResult = player.color === 'white' ? 'loss' : 'win';
        blackPlayerResult = player.color === 'white' ? 'win' : 'loss';
      } else if (result === 'timeout') {
       // Süre doldu - süre aşımı yapan oyuncu kaybetti
        gameResult = player.color === 'white' ? 'black' : 'white';
        whitePlayerResult = player.color === 'white' ? 'loss' : 'win';
        blackPlayerResult = player.color === 'white' ? 'win' : 'loss';
      }
      
      // Veritabanındaki oyunu güncelle
      await Game.findByIdAndUpdate(game.dbId, {
        result: gameResult,
        endTime: new Date()
      });
      
      // ELO hesaplama ve kullanıcı istatistiklerini güncelle
      const whitePlayer = await User.findById(game.players.find(p => p.color === 'white').id);
      const blackPlayer = await User.findById(game.players.find(p => p.color === 'black').id);
      
      if (!whitePlayer || !blackPlayer) {
        console.log('Oyun sonu işleme hatası: Oyunculardan biri bulunamadı');
        return;
      }
      
      // Basit ELO hesaplama
      const kFactor = 32; // ELO değişim faktörü
      
      // Beklenen sonuçlar
      const expectedWhite = 1 / (1 + Math.pow(10, (blackPlayer.elo - whitePlayer.elo) / 400));
      const expectedBlack = 1 / (1 + Math.pow(10, (whitePlayer.elo - blackPlayer.elo) / 400));
      
      // Gerçek sonuçlar
      let actualWhite, actualBlack;
      
      if (gameResult === 'white') {
        actualWhite = 1;
        actualBlack = 0;
      } else if (gameResult === 'black') {
        actualWhite = 0;
        actualBlack = 1;
      } else {
        // Berabere
        actualWhite = 0.5;
        actualBlack = 0.5;
      }
      
      // Yeni ELO puanları
      const newWhiteElo = Math.round(whitePlayer.elo + kFactor * (actualWhite - expectedWhite));
      const newBlackElo = Math.round(blackPlayer.elo + kFactor * (actualBlack - expectedBlack));
      
      // Beyaz oyuncuyu güncelle
      const whiteUpdate = { elo: newWhiteElo, $inc: { gamesPlayed: 1 } };
      if (whitePlayerResult === 'win') whiteUpdate.$inc.wins = 1;
      else if (whitePlayerResult === 'loss') whiteUpdate.$inc.losses = 1;
      else whiteUpdate.$inc.draws = 1;
      
      await User.findByIdAndUpdate(whitePlayer._id, whiteUpdate);
      
      // Siyah oyuncuyu güncelle
      const blackUpdate = { elo: newBlackElo, $inc: { gamesPlayed: 1 } };
      if (blackPlayerResult === 'win') blackUpdate.$inc.wins = 1;
      else if (blackPlayerResult === 'loss') blackUpdate.$inc.losses = 1;
      else blackUpdate.$inc.draws = 1;
      
      await User.findByIdAndUpdate(blackPlayer._id, blackUpdate);
      
      // İki oyuncuya da bilgi gönder
      game.players.forEach(p => {
        const playerSocketId = userSockets.get(p.id);
        if (playerSocketId) {
          io.to(playerSocketId).emit('game_ended', { 
            result: gameResult,
            playerColor: p.color,
            eloChange: p.color === 'white' ? (newWhiteElo - whitePlayer.elo) : (newBlackElo - blackPlayer.elo)
          });
        }
      });
      
      console.log(`Oyun bitti (${gameId}): ${gameResult}`);
      
      // Aktif oyunlar listesinden kaldır
      activeGames.delete(gameId);
      
    } catch (error) {
      console.error('Oyun bitirme hatası:', error);
    }
  });

  // Süre aşımı
  socket.on('time_out', async ({ gameId }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) return;
    
    try {
      const player = game.players.find(p => p.id === socket.userId);
      if (!player) return;
      
      // Süre kontrolü için güvenlik kontrolü
      const playerClock = game.clocks[socket.userId];
      if (playerClock > 0) {
        console.log('Geçersiz süre aşımı bildirimi: Oyuncunun hala zamanı var');
        return;
      }
      
      const result = player.color === 'white' ? 'black' : 'white'; // Süre dolduğu için kaybetti
      
      // Oyunu bitir
      socket.emit('game_over', { gameId, result: 'timeout' });
      
    } catch (error) {
      console.error('Süre aşımı hatası:', error);
    }
  });

  // Sohbet mesajı
  socket.on('send_message', ({ gameId, message }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) return;
    
    const player = game.players.find(p => p.id === socket.userId);
    if (!player) return;
    
    // Mesaj içerik kontrolü
    if (!message || message.trim() === '' || message.length > 500) {
      return; // Boş veya çok uzun mesajları reddet
    }
    
    // Mesajı XSS saldırılarına karşı temizle
    const sanitizedMessage = message
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .trim();
    
    // Mesajı oyunun sohbet geçmişine ekle
    const chatMessage = {
      sender: player.color,
      senderName: player.username,
      text: sanitizedMessage,
      time: new Date().toISOString()
    };
    
    game.messages.push(chatMessage);
    
    // Her iki oyuncuya da gönder
    game.players.forEach(p => {
      const playerSocketId = userSockets.get(p.id);
      if (playerSocketId) {
        io.to(playerSocketId).emit('chat_message', chatMessage);
      }
    });
  });

  // Bağlantı kesilince
  socket.on('disconnect', () => {
    if (socket.userId) {
      console.log(`Oyuncu bağlantısı kesildi: ${socket.userId}`);
      
      // Bekleme listesinden kaldır
      const waitingIndex = waitingPlayers.findIndex(p => p.id === socket.userId);
      if (waitingIndex !== -1) {
        waitingPlayers.splice(waitingIndex, 1);
      }
      
      // Aktif oyunları işle
      for (const [gameId, game] of activeGames.entries()) {
        const playerIndex = game.players.findIndex(p => p.id === socket.userId);
        if (playerIndex !== -1) {
          const opponent = game.players.find(p => p.id !== socket.userId);
          if (opponent) {
            const opponentSocketId = userSockets.get(opponent.id);
            if (opponentSocketId) {
              io.to(opponentSocketId).emit('opponent_disconnected');
            }
          }
          
          // Eğer veritabanında kaydedilmiş bir oyunsa, sonuç güncelle
          if (game.dbId) {
            Game.findByIdAndUpdate(game.dbId, {
              result: socket.userId === game.players.find(p => p.color === 'white').id ? 'black' : 'white',
              endTime: new Date()
            }).catch(err => console.error('Oyun güncelleme hatası:', err));
          }
          
          activeGames.delete(gameId);
        }
      }
      
      // Socket-User eşleşmesini kaldır
      userSockets.delete(socket.userId);
    }
  });
});

// Genel hata yakalama
process.on('uncaughtException', (err) => {
  console.error('Yakalanmamış İstisna:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('İşlenmeyen Reddetme:', reason);
});

// Sunucuyu başlat
server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});