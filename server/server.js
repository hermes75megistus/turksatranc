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
  draws: { type: Number, default: 0 },
  isGuest: { type: Boolean, default: false } // Misafir kullanıcı olup olmadığı
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
  saveUninitialized: true, // Misafir kullanıcılar için true olmalı
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

// Auth middleware - Giriş yapılmamışsa misafir kullanıcı oluştur
const isAuthenticated = async (req, res, next) => {
  // Eğer oturum zaten varsa devam et
  if (req.session.userId) {
    return next();
  }
  
  // API istekleri için 401 hatası döndür
  if (req.path.startsWith('/api/') && req.path !== '/api/misafir-giris') {
    if (req.xhr || req.headers.accept && req.headers.accept.indexOf('json') > -1) {
      return res.status(401).json({ error: 'Giriş yapmanız gerekiyor', redirect: '/giris' });
    }
  }
  
  // HTML sayfası istekleri için giriş sayfasına yönlendir
  if (!req.path.startsWith('/api/') && req.path !== '/giris' && req.path !== '/kayit' && req.path !== '/') {
    return res.redirect('/giris');
  }
  
  // Ana sayfa veya API dışındaki istekler için devam et
  next();
};

// Misafir kullanıcı oluşturma fonksiyonu
const createGuestUser = async () => {
  try {
    const guestUsername = `Misafir_${Math.random().toString(36).substring(2, 10)}`;
    const guestEmail = `${guestUsername}@turksatranc.com`;
    const guestPassword = Math.random().toString(36).substring(2, 15);
    
    // Parolayı hashle
    const hashedPassword = await bcrypt.hash(guestPassword, 10);
    
    // Misafir kullanıcı oluştur
    const guestUser = new User({
      username: guestUsername,
      email: guestEmail,
      password: hashedPassword,
      isGuest: true
    });
    
    await guestUser.save();
    return guestUser;
  } catch (error) {
    console.error('Misafir kullanıcı oluşturma hatası:', error);
    throw error;
  }
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

// Misafir giriş API'si
app.post('/api/misafir-giris', async (req, res) => {
  try {
    // Misafir kullanıcı oluştur
    const guestUser = await createGuestUser();
    
    // Oturumu başlat
    req.session.userId = guestUser._id;
    req.session.isGuest = true;
    
    res.json({ 
      success: true, 
      redirect: '/',
      user: {
        username: guestUser.username,
        elo: guestUser.elo,
        isGuest: true
      }
    });
  } catch (error) {
    console.error('Misafir giriş hatası:', error);
    res.status(500).json({ error: 'Misafir giriş işlemi başarısız oldu' });
  }
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
    req.session.isGuest = false;
    
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
    req.session.isGuest = false;
    
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

// Kullanıcı profil sayfası - Auth gerektirir
app.get('/profil', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/profil.html'));
});

app.get('/api/kullanici', async (req, res) => {
  try {
    // Kullanıcı girişi yoksa misafir kullanıcı bilgisi döndür
    if (!req.session.userId) {
      return res.json({
        username: 'Misafir',
        elo: 1200,
        isGuest: true
      });
    }
    
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
app.get('/', (req, res) => {
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
  res.redirect('/');
});

// Socket.io - Oyun işlemleri
// -------------------------------------------------------------------------------

// Aktif oyuncular ve oyunlar için depo
const waitingPlayers = [];
const activeGames = new Map();
const userSockets = new Map(); // Kullanıcı ID - Socket ID eşleşmesi

// Socket kimlik doğrulama için middleware
io.use(async (socket, next) => {
  try {
    // Session ve cookie bilgilerini kontrol et
    const cookies = socket.handshake.headers.cookie;
    console.log('Socket bağlantısı - cookies:', cookies ? 'Var' : 'Yok');
    
    let userId = null;
    let isGuest = true;
    
    // Oturum açılmışsa userId al
    if (cookies && cookies.includes('connect.sid=')) {
      // Burada gerçek bir session store kullanarak userId'yi almalısınız
      // Örnek amaçlı sadece cookie'nin varlığını kontrol ediyoruz
      console.log('Socket bağlantısı - oturum çerezi bulundu');
      
      // Socket handshake'ten auth verilerini kontrol et
      if (socket.handshake.auth && socket.handshake.auth.userId) {
        userId = socket.handshake.auth.userId;
        isGuest = false;
        
        // Kullanıcı bilgisini doğrula
        const user = await User.findById(userId);
        if (user) {
          socket.userId = user._id;
          socket.username = user.username;
          socket.isGuest = user.isGuest || false;
          
          // Socket ID ile kullanıcı eşleştir
          userSockets.set(user._id.toString(), socket.id);
          console.log(`Kullanıcı eşleşmesi: ${user.username} -> ${socket.id}`);
          return next();
        }
      }
    }
    
    // Oturum yoksa veya kullanıcı bulunamadıysa misafir kullanıcı oluştur
    console.log('Socket bağlantısı - misafir kullanıcı oluşturuluyor');
    const guestUser = await createGuestUser();
    socket.userId = guestUser._id;
    socket.username = guestUser.username;
    socket.isGuest = true;
    
    // Socket ID ile kullanıcı eşleştir
    userSockets.set(guestUser._id.toString(), socket.id);
    console.log(`Misafir kullanıcı eşleşmesi: ${guestUser.username} -> ${socket.id}`);
    
    return next();
  } catch (error) {
    console.error('Socket kimlik doğrulama hatası:', error);
    
    // Hata durumunda da misafir kullanıcı oluştur
    try {
      const guestUser = await createGuestUser();
      socket.userId = guestUser._id;
      socket.username = guestUser.username;
      socket.isGuest = true;
      userSockets.set(guestUser._id.toString(), socket.id);
      return next();
    } catch (innerError) {
      return next(new Error('Misafir kullanıcı oluşturma hatası'));
    }
  }
});

io.on('connection', async (socket) => {
  console.log(`Yeni socket bağlantısı: ${socket.id}, Kullanıcı: ${socket.username || 'Bilinmiyor'}, UserId: ${socket.userId || 'Yok'}`);
  
  // Tüm socket hatalarını yakalama
  socket.on('error', (error) => {
    console.error('Socket hatası:', error);
  });
  
  // Kullanıcı kimliğini belirle
  socket.on('authenticate', async (userId) => {
    try {
      console.log(`Kimlik doğrulama isteği userId: ${userId}, socket.userId: ${socket.userId}`);
      
      // Kullanıcı zaten doğrulandıysa ve aynı kimlikse işleme gerek yok
      if (socket.userId && socket.userId.toString() === userId) {
        console.log('Kullanıcı zaten doğrulanmış, işlem atlanıyor.');
        return;
      }
      
      // Kullanıcıyı doğrula
      if (userId) {
        const user = await User.findById(userId);
        if (user) {
          console.log(`Kullanıcı bulundu: ${user.username}`);
          socket.userId = user._id;
          socket.username = user.username;
          socket.isGuest = user.isGuest || false;
          
          // Kullanıcı Socket Map'e kaydet
          userSockets.set(user._id.toString(), socket.id);
          console.log(`Kullanıcı socket eşleşmesi güncellendi: ${user.username} -> ${socket.id}`);
          return;
        }
      }
      
      // Kullanıcı bulunamadıysa ve socket.userId yoksa, misafir kullanıcı oluştur
      if (!socket.userId) {
        const guestUser = await createGuestUser();
        socket.userId = guestUser._id;
        socket.username = guestUser.username;
        socket.isGuest = true;
        
        // Kullanıcı Socket Map'e kaydet
        userSockets.set(guestUser._id.toString(), socket.id);
        console.log(`Misafir kullanıcı oluşturuldu: ${guestUser.username}`);
      }
    } catch (error) {
      console.error('Kimlik doğrulama hatası:', error);
    }
  });

  // Oyuncu eşleşme için arama
  socket.on('find_match', async (timeControl) => {
    console.log(`Eşleşme isteği - Socket: ${socket.id}, Kullanıcı: ${socket.username || 'Bilinmiyor'}`);
    
    if (!socket.userId) {
      console.log('Eşleşme hatası: Kullanıcı kimliği yok');
      socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı, lütfen sayfayı yenileyin' });
      return;
    }
    
    try {
      // Kullanıcı bilgisini doğrula
      const user = await User.findById(socket.userId);
      
      if (!user) {
        console.log('Eşleşme hatası: Kullanıcı bulunamadı:', socket.userId);
        socket.emit('error', { message: 'Kullanıcı bulunamadı, lütfen sayfayı yenileyin' });
        return;
      }
      
      // Geçerli bir sayı olduğundan emin ol
      timeControl = parseInt(timeControl) || 15;
      console.log(`Eşleşme parametreleri - Kullanıcı: ${user.username}, Süre: ${timeControl}dk, ELO: ${user.elo}`);
      
      // Önce mevcut bekleme listesinden bu kullanıcıyı kaldır
      const existingIndex = waitingPlayers.findIndex(p => p.id.toString() === socket.userId.toString());
      if (existingIndex !== -1) {
        waitingPlayers.splice(existingIndex, 1);
        console.log(`Kullanıcı bekleme listesinden kaldırıldı: ${user.username}`);
      }
      
      // Bekleme listesini kontrol et - aynı zamanlı eşleşme
      console.log(`Bekleme listesi durumu: ${waitingPlayers.length} oyuncu bekliyor`);
      
      // Bu kullanıcı için bir eşleşme bul (aynı süre kontrolüne sahip kullanıcı)
      const waitingPlayerIndex = waitingPlayers.findIndex(p => {
        return p.id.toString() !== socket.userId.toString() &&  // kendisiyle eşleşmesin
               p.timeControl === timeControl;  // aynı süre kontrolü
      });
      
      if (waitingPlayerIndex !== -1) {
        // Eşleşme bulundu
        const opponent = waitingPlayers.splice(waitingPlayerIndex, 1)[0];
        const gameId = Math.random().toString(36).substring(2, 15);
        
        console.log(`Eşleşme bulundu! ${user.username} ve ${opponent.username} arasında, süre: ${timeControl}dk`);
        
        // Rastgele renk ataması (beyaz/siyah)
        const randomBoolean = Math.random() < 0.5;
        const whitePlayerId = randomBoolean ? socket.userId : opponent.id;
        const blackPlayerId = randomBoolean ? opponent.id : socket.userId;
        
        const whitePlayer = await User.findById(whitePlayerId);
        const blackPlayer = await User.findById(blackPlayerId);
        
        if (!whitePlayer || !blackPlayer) {
          console.log('Eşleşme başarısız: Oyunculardan biri bulunamadı');
          socket.emit('error', { message: 'Eşleşme başarısız' });
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
    [whitePlayerId.toString()]: timeInMilliseconds,
    [blackPlayerId.toString()]: timeInMilliseconds
  },
  lastMoveTime: Date.now(),
  currentTurn: 'white',
  messages: []
});
        
        // Her iki oyuncuya da eşleşme bilgisini gönder
        const whiteSocketId = userSockets.get(whitePlayerId.toString());
        const blackSocketId = userSockets.get(blackPlayerId.toString());
        
        console.log('Eşleşme bilgisi gönderiliyor:');
        console.log(`Beyaz (${whitePlayer.username}) -> Socket: ${whiteSocketId}`);
        console.log(`Siyah (${blackPlayer.username}) -> Socket: ${blackSocketId}`);
        
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
        
        console.log(`Eşleşme oluşturuldu: ${gameId}, oyuncular: ${whitePlayer.username} ve ${blackPlayer.username}, süre: ${timeControl} dakika`);
      } else {
        // Eşleşme bulunamadı, bekleme listesine ekle
        waitingPlayers.push({ 
          id: socket.userId, 
          joinedAt: Date.now(),
          timeControl: timeControl,
          elo: user.elo,
          username: user.username
        });
        socket.emit('waiting');
        console.log(`Oyuncu bekleme listesine eklendi: ${user.username} - Süre: ${timeControl}dk - Bekleyen oyuncu sayısı: ${waitingPlayers.length}`);
        console.log('Bekleme listesi:', waitingPlayers.map(p => p.username));
      }
    } catch (error) {
      console.error('Eşleşme oluşturma hatası:', error);
      socket.emit('error', { message: 'Eşleşme bulunurken bir hata oluştu' });
    }
  });

  // Hamle yapma
  socket.on('move', async ({ gameId, move, fen, pgn }) => {
    console.log(`Hamle isteği - Socket: ${socket.id}, Oyun: ${gameId}, Hamle: ${move.from} -> ${move.to}`);
    
    if (!socket.userId) {
      socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      console.log('Oyun bulunamadı:', gameId);
      socket.emit('error', { message: 'Oyun bulunamadı' });
      return;
    }
    
    // Hamle yapma sırasını kontrol et
    const player = game.players.find(p => p.id.toString() === socket.userId.toString());
    if (!player) {
      console.log('Bu oyuncu bu oyuna ait değil');
      socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
      return;
    }
    
    if ((game.currentTurn === 'white' && player.color !== 'white') || 
        (game.currentTurn === 'black' && player.color !== 'black')) {
      console.log('Sıra bu oyuncuda değil');
      socket.emit('error', { message: 'Şu anda hamle sırası sizde değil' });
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
      game.clocks[socket.userId.toString()] -= timeDiff;
      
      // Sırayı değiştir
      game.currentTurn = player.color === 'white' ? 'black' : 'white';
      game.lastMoveTime = now;
      
      // Rakibe bildir
      const opponent = game.players.find(p => p.id.toString() !== socket.userId.toString());
      if (opponent) {
        const opponentSocketId = userSockets.get(opponent.id.toString());
        console.log(`Rakibe hamle bildiriliyor: ${opponent.username} -> Socket: ${opponentSocketId}`);
        
        if (opponentSocketId) {
          io.to(opponentSocketId).emit('opponent_move', { 
            move, 
            fen, 
            pgn,
            whiteTime: game.clocks[game.players.find(p => p.color === 'white').id.toString()],
            blackTime: game.clocks[game.players.find(p => p.color === 'black').id.toString()]
          });
        }
      }
    } catch (error) {
      console.error('Hamle işleme hatası:', error);
      socket.emit('error', { message: 'Hamle işlenirken bir hata oluştu' });
    }
  });

  // Oyun bitti
  socket.on('game_over', async ({ gameId, result }) => {
    console.log(`Oyun bitti isteği - Socket: ${socket.id}, Oyun: ${gameId}, Sonuç: ${result}`);
    
    if (!socket.userId) {
      socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      console.log('Oyun bitirme hatası: Oyun bulunamadı');
      socket.emit('error', { message: 'Oyun bulunamadı' });
      return;
    }
    
    try {
      const player = game.players.find(p => p.id.toString() === socket.userId.toString());
      if (!player) {
        console.log('Bu oyuncu bu oyuna ait değil');
        socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
        return;
      }
      
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
        socket.emit('error', { message: 'Oyuncular bulunamadı' });
        return;
      }
      
      let newWhiteElo = whitePlayer.elo;
      let newBlackElo = blackPlayer.elo;
      
      try {
        // Misafir kullanıcıları istatistik güncellemeden hariç tut
        if (!whitePlayer.isGuest && !blackPlayer.isGuest) {
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
          newWhiteElo = Math.round(whitePlayer.elo + kFactor * (actualWhite - expectedWhite));
          newBlackElo = Math.round(blackPlayer.elo + kFactor * (actualBlack - expectedBlack));
          
          // Beyaz oyuncuyu güncelle - misafir olmayan oyuncular için
          if (!whitePlayer.isGuest) {
            const whiteUpdate = { elo: newWhiteElo, $inc: { gamesPlayed: 1 } };
            if (whitePlayerResult === 'win') whiteUpdate.$inc.wins = 1;
            else if (whitePlayerResult === 'loss') whiteUpdate.$inc.losses = 1;
            else whiteUpdate.$inc.draws = 1;
            
            await User.findByIdAndUpdate(whitePlayer._id, whiteUpdate);
          }
          
          // Siyah oyuncuyu güncelle - misafir olmayan oyuncular için
          if (!blackPlayer.isGuest) {
            const blackUpdate = { elo: newBlackElo, $inc: { gamesPlayed: 1 } };
            if (blackPlayerResult === 'win') blackUpdate.$inc.wins = 1;
            else if (blackPlayerResult === 'loss') blackUpdate.$inc.losses = 1;
            else blackUpdate.$inc.draws = 1;
            
            await User.findByIdAndUpdate(blackPlayer._id, blackUpdate);
          }
        }
      } catch (updateError) {
        console.error('ELO ve istatistik güncelleme hatası:', updateError);
      }
      
      // İki oyuncuya da bilgi gönder
      game.players.forEach(p => {
        const playerSocketId = userSockets.get(p.id.toString());
        if (playerSocketId) {
          // ELO değişimini hesapla
          const player = p.color === 'white' ? whitePlayer : blackPlayer;
          const initialElo = player.elo;
          const newElo = p.color === 'white' ? newWhiteElo : newBlackElo;
          const eloChange = player.isGuest ? 0 : (newElo - initialElo);
          
          console.log(`Oyun sonu bilgisi gönderiliyor: ${player.username} -> Socket: ${playerSocketId}`);
          console.log(`ELO değişimi: ${initialElo} -> ${newElo} (${eloChange > 0 ? '+' : ''}${eloChange})`);
          
          io.to(playerSocketId).emit('game_ended', { 
            result: gameResult,
            playerColor: p.color,
            eloChange: eloChange
          });
        }
      });
      
      console.log(`Oyun bitti (${gameId}): ${gameResult}`);
      
      // Aktif oyunlar listesinden kaldır
      activeGames.delete(gameId);
    } catch (error) {
      console.error('Oyun bitirme hatası:', error);
      socket.emit('error', { message: 'Oyun sonlandırılırken bir hata oluştu' });
    }
  });

  // Süre aşımı
  socket.on('time_out', async ({ gameId }) => {
    console.log(`Süre aşımı bildirimi - Socket: ${socket.id}, Oyun: ${gameId}`);
    
    if (!socket.userId) {
      socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      console.log('Oyun bulunamadı:', gameId);
      socket.emit('error', { message: 'Oyun bulunamadı' });
      return;
    }
    
    try {
      const player = game.players.find(p => p.id.toString() === socket.userId.toString());
      if (!player) {
        console.log('Bu oyuncu bu oyuna ait değil');
        socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
        return;
      }
      
      // Süre kontrolü için güvenlik kontrolü
      const playerClock = game.clocks[socket.userId.toString()];
      if (playerClock > 0) {
        console.log('Geçersiz süre aşımı bildirimi: Oyuncunun hala zamanı var:', playerClock);
        socket.emit('error', { message: 'Geçersiz süre aşımı bildirimi' });
        return;
      }
      
      const result = player.color === 'white' ? 'black' : 'white'; // Süre dolduğu için kaybetti
      
      // Oyunu bitir
      socket.emit('game_over', { gameId, result: 'timeout' });
    } catch (error) {
      console.error('Süre aşımı hatası:', error);
      socket.emit('error', { message: 'Süre aşımı işlenirken bir hata oluştu' });
    }
  });

  // Sohbet mesajı
  socket.on('send_message', ({ gameId, message }) => {
    console.log(`Sohbet mesajı - Socket: ${socket.id}, Oyun: ${gameId}, Mesaj: "${message.substring(0, 20)}${message.length > 20 ? '...' : ''}"`);
    
    if (!socket.userId) {
      socket.emit('error', { message: 'Kullanıcı kimliği bulunamadı' });
      return;
    }
    
    const game = activeGames.get(gameId);
    if (!game) {
      console.log('Oyun bulunamadı:', gameId);
      socket.emit('error', { message: 'Oyun bulunamadı' });
      return;
    }
    
    const player = game.players.find(p => p.id.toString() === socket.userId.toString());
    if (!player) {
      console.log('Bu oyuncu bu oyuna ait değil');
      socket.emit('error', { message: 'Bu oyuna katılma yetkiniz yok' });
      return;
    }
    
    // Mesaj içerik kontrolü
    if (!message || message.trim() === '' || message.length > 500) {
      socket.emit('error', { message: 'Geçersiz mesaj' });
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
      const playerSocketId = userSockets.get(p.id.toString());
      if (playerSocketId) {
        io.to(playerSocketId).emit('chat_message', chatMessage);
      }
    });
  });

  // Bağlantı kesilince
  socket.on('disconnect', () => {
    console.log(`Bağlantı kesildi: ${socket.id}, Kullanıcı: ${socket.username || 'Bilinmiyor'}`);
    
    if (socket.userId) {
      // Bekleme listesinden kaldır
      const waitingIndex = waitingPlayers.findIndex(p => p.id.toString() === socket.userId.toString());
      if (waitingIndex !== -1) {
        console.log(`Kullanıcı bekleme listesinden çıkarıldı: ${waitingPlayers[waitingIndex].username}`);
        waitingPlayers.splice(waitingIndex, 1);
      }
      
      // Aktif oyunları işle
      for (const [gameId, game] of activeGames.entries()) {
        const playerIndex = game.players.findIndex(p => p.id.toString() === socket.userId.toString());
        if (playerIndex !== -1) {
          const player = game.players[playerIndex];
          const opponent = game.players.find(p => p.id.toString() !== socket.userId.toString());
          
          console.log(`Aktif oyuncu bağlantısı kesildi: ${player.username}, Oyun: ${gameId}`);
          
          if (opponent) {
            const opponentSocketId = userSockets.get(opponent.id.toString());
            if (opponentSocketId) {
              console.log(`Rakibe bağlantı kesinti bildirimi: ${opponent.username}`);
              io.to(opponentSocketId).emit('opponent_disconnected');
            }
          }
          
          // Eğer veritabanında kaydedilmiş bir oyunsa, sonuç güncelle
          if (game.dbId) {
            const winnerColor = socket.userId === game.players.find(p => p.color === 'white').id ? 'black' : 'white';
            Game.findByIdAndUpdate(game.dbId, {
              result: winnerColor,
              endTime: new Date()
            }).catch(err => console.error('Oyun güncelleme hatası:', err));
            
            console.log(`Oyun sonucu güncellendi: ${gameId}, Kazanan: ${winnerColor}`);
          }
          
          activeGames.delete(gameId);
        }
      }
      
      // Socket-User eşleşmesini kaldır
      userSockets.delete(socket.userId.toString());
    }
  });
});

// Debug bilgilerini düzenli aralıklarla logla
setInterval(() => {
  console.log("------- SUNUCU DURUMU -------");
  console.log(`Aktif oyunlar: ${activeGames.size}`);
  console.log(`Bekleyen oyuncular: ${waitingPlayers.length}`);
  console.log(`Socket-Kullanıcı eşleşmeleri: ${userSockets.size}`);
  console.log("-----------------------------");
}, 60000); // Her 1 dakikada bir

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
    
